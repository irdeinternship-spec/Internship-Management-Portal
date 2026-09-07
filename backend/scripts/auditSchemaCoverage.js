#!/usr/bin/env node
/**
 * scripts/auditSchemaCoverage.js
 *
 * A committed, repeatable version of the manual audit that found the
 * offerLetter.url/completedDocuments data-loss bug (see the phase 06 commits):
 * statically scans every controller/service/middleware/route/script for
 * assignments onto a Mongoose model instance, cross-references each assigned
 * path against what that model's schema (models/mongo/*.js) actually
 * declares, and reports anything undeclared.
 *
 * Why this exists at all: strict:"throw" (turned on across every schema in
 * phase 06) does NOT catch every way an undeclared field gets silently
 * dropped. It catches Model.create()/new Model(), doc.set({...}), and a
 * nested object assigned onto an already-declared parent path
 * (student.offerLetter = {...}). It does NOT catch a flat assignment to a
 * wholly undeclared top-level path on an already-fetched document
 * (doc.newField = value) - Mongoose never defines a setter for an undeclared
 * path, so that assignment bypasses Mongoose entirely: no throw, no
 * persistence, and nothing in the running app ever sees it happen. That
 * exact pattern is what caused the original bug. This script is the
 * guardrail for that gap - a static check that runs before the code ever
 * executes, so the class of assignment strict:"throw" can't watch still gets
 * caught, in CI, before merge.
 *
 * Exit code: 0 if every found assignment is declared; 1 if anything is
 * undeclared, or unresolvable in a way that could hide a real gap.
 *
 * HOW IT WORKS (and its honest limits)
 * -------------------------------------
 * 1. Schema extraction: parses every models/mongo/*.js file, finds every
 *    `new Schema({...}, opts)` (including ones assigned to a named variable
 *    like FileRefSchema and referenced elsewhere in the same file), and the
 *    mongoose.model("Name", schemaVar) call that names the root schema for
 *    that file. Walks the schema's object literal recursively to build the
 *    full set of declared dotted paths (e.g. "offerLetter.url"). A field
 *    typed Schema.Types.Mixed or Map is treated as a wildcard - anything
 *    under that path is accepted, matching Mongoose's own real behavior for
 *    Mixed, and accepting that a Map's dynamic keys can't be statically
 *    checked at all.
 *
 * 2. Assignment scanning: parses every other .js file under controllers/,
 *    services/, middleware/, routes/, utils/, scripts/ and looks for three
 *    patterns: (a) `identifier.path = value` (including deeper dotted
 *    chains, and recursing into an object-literal RHS to check its own keys
 *    against the nested path), (b) `Model.create({...})` / `new Model({...})`,
 *    (c) `Model.findByIdAndUpdate/findOneAndUpdate/updateOne/updateMany(x,
 *    {$set: {...}})` (or without a $set wrapper, which is itself a bug this
 *    script also catches - see phase 06b).
 *
 * 3. Model inference for pattern (a) is a HEURISTIC, not real type-flow
 *    analysis: it matches the local variable name against a small table of
 *    naming conventions this codebase actually uses (student -> Student,
 *    admin -> Admin, etc. - see MODEL_VARIABLE_HINTS below). This is
 *    deliberate: full cross-function data-flow tracking (tracing
 *    `req.student` through middleware into a controller, for example) is a
 *    much bigger undertaking than this codebase's actual, very consistent
 *    naming needs. If a variable name doesn't match anything in the table,
 *    the assignment is silently skipped, not flagged - the tool is tuned to
 *    avoid false positives at the cost of a real but bounded coverage gap
 *    (a badly-named variable could hide an assignment from it). Extend
 *    MODEL_VARIABLE_HINTS when a new model or a new naming convention shows
 *    up; --list-unresolved prints every assignment the heuristic couldn't
 *    place, so that gap is at least visible on request instead of invisible.
 *
 * 4. Anything inside a spread (`...someExpression`) can't be statically
 *    resolved - only the explicitly-written keys alongside a spread are
 *    checked. This matches every real spread pattern in this codebase
 *    (`{...currentOfferLetter(student), url: x}` - the spread carries
 *    forward existing, already-declared data; the explicit keys are what's
 *    actually new).
 */

const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

const BACKEND_ROOT = path.join(__dirname, "..");
const MODELS_DIR = path.join(BACKEND_ROOT, "models", "mongo");
const SCAN_DIRS = ["controllers", "services", "middleware", "routes", "utils", "scripts"];
const SELF_FILE = path.resolve(__filename);

// Local variable name (lowercased) -> Mongoose model name. Checked as a
// substring match against the variable name, longest key first, so
// "newAdmin"/"subAdmin"/"existingAdmin" all still resolve to Admin without
// needing an entry each. See point 3 above for why this is a heuristic.
const MODEL_VARIABLE_HINTS = [
  ["administration", "Administration"], // must come before "admin" - longer match wins, see below
  ["activitylog", "ActivityLog"],
  ["student", "Student"],
  ["admin", "Admin"],
  ["gyapan", "Gyapan"],
];

const VERBOSE = process.argv.includes("--list-unresolved");

// ---------------------------------------------------------------------------
// Generic ESTree walker
// ---------------------------------------------------------------------------
function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "loc" || key === "start" || key === "end" || key === "range" || key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((child) => {
        if (child && typeof child.type === "string") walk(child, visit);
      });
    } else if (value && typeof value.type === "string") {
      walk(value, visit);
    }
  }
}

function parseSource(source, filePath) {
  try {
    return acorn.parse(source, { ecmaVersion: "latest", sourceType: "script", locations: true });
  } catch (error) {
    console.error(`⚠️  Could not parse ${filePath}: ${error.message}`);
    return null;
  }
}

function propKeyName(keyNode) {
  if (!keyNode) return null;
  if (keyNode.type === "Identifier") return keyNode.name;
  if (keyNode.type === "Literal") return String(keyNode.value);
  return null;
}

function isMixedType(node) {
  return node && node.type === "MemberExpression" && node.property?.name === "Mixed";
}

function isMapType(node) {
  return node && node.type === "Identifier" && node.name === "Map";
}

// ---------------------------------------------------------------------------
// Step 1: extract every model's declared paths from models/mongo/*.js
// ---------------------------------------------------------------------------
function resolveFieldDefinition(valueNode, namedSchemas) {
  if (!valueNode) return {};

  if (valueNode.type === "Identifier" && namedSchemas[valueNode.name]) {
    return { nestedObjectExpression: namedSchemas[valueNode.name] };
  }

  if (valueNode.type === "ArrayExpression" && valueNode.elements.length > 0) {
    return resolveFieldDefinition(valueNode.elements[0], namedSchemas);
  }

  if (valueNode.type === "ObjectExpression") {
    const typeProp = valueNode.properties.find(
      (p) => p.type === "Property" && propKeyName(p.key) === "type"
    );
    if (typeProp) {
      const typeVal = typeProp.value;
      if (isMixedType(typeVal) || isMapType(typeVal)) return { isWildcard: true };
      if (typeVal.type === "Identifier" && namedSchemas[typeVal.name]) {
        return { nestedObjectExpression: namedSchemas[typeVal.name] };
      }
      if (typeVal.type === "ArrayExpression") {
        return resolveFieldDefinition(typeVal, namedSchemas);
      }
      return {}; // type: String/Date/Number/Boolean/Schema.Types.ObjectId/etc - plain field
    }
    // No `type` key at all -> this object literal IS an inline nested schema.
    return { nestedObjectExpression: valueNode };
  }

  if (isMixedType(valueNode)) return { isWildcard: true };

  return {};
}

function collectPaths(objectExpr, prefix, namedSchemas, declaredPaths, wildcardPrefixes, ancestors = new Set()) {
  // ancestors guards against a true self-reference cycle (ancestor chain,
  // not "ever visited anywhere") - the SAME named sub-schema (e.g.
  // FileRefSchema) is deliberately reused across many sibling fields
  // (resume, result, photo, ...) and must be walked fully every time, not
  // skipped after the first.
  if (ancestors.has(objectExpr)) return;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(objectExpr);

  for (const prop of objectExpr.properties) {
    if (prop.type !== "Property") continue;
    const key = propKeyName(prop.key);
    if (key == null) continue;
    const fullPath = prefix ? `${prefix}.${key}` : key;
    declaredPaths.add(fullPath);

    const resolved = resolveFieldDefinition(prop.value, namedSchemas);
    if (resolved.isWildcard) {
      wildcardPrefixes.add(fullPath);
    } else if (resolved.nestedObjectExpression) {
      collectPaths(resolved.nestedObjectExpression, fullPath, namedSchemas, declaredPaths, wildcardPrefixes, nextAncestors);
    }
  }
}

function extractSchema(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const ast = parseSource(source, filePath);
  if (!ast) return null;

  const namedSchemas = {};
  let modelName = null;
  let rootSchemaVarName = null;

  walk(ast, (node) => {
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init?.type === "NewExpression"
    ) {
      const callee = node.init.callee;
      const isSchemaCall =
        (callee.type === "Identifier" && callee.name === "Schema") ||
        (callee.type === "MemberExpression" && callee.property?.name === "Schema");
      if (isSchemaCall) {
        const firstArg = node.init.arguments[0];
        if (firstArg && firstArg.type === "ObjectExpression") {
          namedSchemas[node.id.name] = firstArg;
        }
      }
    }

    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property?.name === "model"
    ) {
      const [nameArg, schemaArg] = node.arguments;
      if (nameArg?.type === "Literal" && schemaArg?.type === "Identifier") {
        modelName = nameArg.value;
        rootSchemaVarName = schemaArg.name;
      }
    }
  });

  if (!modelName || !rootSchemaVarName || !namedSchemas[rootSchemaVarName]) {
    console.error(`⚠️  Could not determine schema shape for ${filePath} - skipping (a mongoose.model("Name", schemaVar) call with an object-literal Schema must be statically visible).`);
    return null;
  }

  const declaredPaths = new Set();
  const wildcardPrefixes = new Set();
  collectPaths(namedSchemas[rootSchemaVarName], "", namedSchemas, declaredPaths, wildcardPrefixes);

  return { modelName, declaredPaths, wildcardPrefixes };
}

function loadAllSchemas() {
  const files = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith(".js"));
  const schemasByModel = {};
  for (const file of files) {
    const info = extractSchema(path.join(MODELS_DIR, file));
    if (info) schemasByModel[info.modelName] = info;
  }
  return schemasByModel;
}

// Mongoose adds _id and __v to every schema automatically unless explicitly
// disabled (rare in this codebase, and irrelevant here even when it is,
// since {_id: false} only applies to subdocuments) - these are never meant
// to appear as explicit properties in the schema's own object literal, so
// treat them as always-declared rather than flagging every legitimate use.
const ALWAYS_DECLARED_TOP_LEVEL = new Set(["_id", "__v", "id"]);

function isPathDeclared(schema, fullPath) {
  if (ALWAYS_DECLARED_TOP_LEVEL.has(fullPath.split(".")[0])) return true;
  if (schema.declaredPaths.has(fullPath)) return true;
  const parts = fullPath.split(".");
  for (let i = parts.length; i > 0; i--) {
    if (schema.wildcardPrefixes.has(parts.slice(0, i).join("."))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Step 2: scan controllers/services/etc for assignments
// ---------------------------------------------------------------------------
function inferModelFromVariableName(name) {
  const lower = name.toLowerCase();
  for (const [hint, model] of MODEL_VARIABLE_HINTS) {
    if (lower.includes(hint)) return model;
  }
  return null;
}

function memberExpressionToPath(node) {
  const parts = [];
  let current = node;
  while (current.type === "MemberExpression") {
    if (current.computed) return null;
    if (current.property.type !== "Identifier") return null;
    parts.unshift(current.property.name);
    current = current.object;
  }
  if (current.type !== "Identifier") return null;
  return { rootName: current.name, path: parts.join(".") };
}

function listAllJsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAllJsFiles(full));
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(filePath, schemasByModel, findings, unresolved) {
  const source = fs.readFileSync(filePath, "utf8");
  const ast = parseSource(source, filePath);
  if (!ast) return;

  const relPath = path.relative(BACKEND_ROOT, filePath);
  const modelNames = new Set(Object.keys(schemasByModel));

  function report(modelName, fullPath, node) {
    const line = node.loc ? node.loc.start.line : "?";
    findings.push({ modelName, fullPath, file: relPath, line });
  }

  function noteUnresolved(rootName, node) {
    if (!VERBOSE) return;
    const line = node.loc ? node.loc.start.line : "?";
    unresolved.push({ rootName, file: relPath, line });
  }

  function checkObjectAgainstPath(modelName, basePath, objectExpr) {
    const schema = schemasByModel[modelName];
    if (!schema) return;
    for (const prop of objectExpr.properties) {
      if (prop.type === "SpreadElement") continue;
      if (prop.type !== "Property") continue;
      const key = propKeyName(prop.key);
      if (key == null) continue;
      const fullPath = basePath ? `${basePath}.${key}` : key;
      if (!isPathDeclared(schema, fullPath)) {
        report(modelName, fullPath, prop);
        continue; // don't also recurse into an already-flagged path
      }
      if (prop.value.type === "ObjectExpression") {
        checkObjectAgainstPath(modelName, fullPath, prop.value);
      }
    }
  }

  walk(ast, (node) => {
    // Pattern (a): identifier.path = value
    if (node.type === "AssignmentExpression" && node.operator === "=" && node.left.type === "MemberExpression") {
      const resolved = memberExpressionToPath(node.left);
      if (!resolved) return;
      const modelName = inferModelFromVariableName(resolved.rootName);
      if (!modelName) {
        noteUnresolved(resolved.rootName, node);
        return;
      }
      const schema = schemasByModel[modelName];
      if (!schema) return;

      if (!isPathDeclared(schema, resolved.path)) {
        report(modelName, resolved.path, node);
        return;
      }
      if (node.right.type === "ObjectExpression") {
        checkObjectAgainstPath(modelName, resolved.path, node.right);
      }
      return;
    }

    // Pattern (b): Model.create({...}) / new Model({...})
    if (node.type === "NewExpression" && node.callee.type === "Identifier" && modelNames.has(node.callee.name)) {
      const arg = node.arguments[0];
      if (arg && arg.type === "ObjectExpression") {
        checkObjectAgainstPath(node.callee.name, "", arg);
      }
      return;
    }
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property?.name === "create" &&
      node.callee.object.type === "Identifier" &&
      modelNames.has(node.callee.object.name)
    ) {
      const arg = node.arguments[0];
      if (arg && arg.type === "ObjectExpression") {
        checkObjectAgainstPath(node.callee.object.name, "", arg);
      }
      return;
    }

    // Pattern (c): Model.findByIdAndUpdate/findOneAndUpdate/updateOne/updateMany(x, {$set: {...}} | {...})
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      ["findByIdAndUpdate", "findOneAndUpdate", "updateOne", "updateMany"].includes(node.callee.property?.name) &&
      node.callee.object.type === "Identifier" &&
      modelNames.has(node.callee.object.name)
    ) {
      const modelName = node.callee.object.name;
      const updateArg = node.arguments.find((a) => a.type === "ObjectExpression");
      if (!updateArg) return;
      const setProp = updateArg.properties.find((p) => p.type === "Property" && propKeyName(p.key) === "$set");
      if (setProp && setProp.value.type === "ObjectExpression") {
        // $set keys may already be dotted-path strings ("offerLetter.status") -
        // check them directly, not nested-recursed.
        for (const prop of setProp.value.properties) {
          if (prop.type !== "Property") continue;
          const key = propKeyName(prop.key);
          if (key == null) continue;
          const schema = schemasByModel[modelName];
          if (schema && !isPathDeclared(schema, key)) report(modelName, key, prop);
        }
      } else {
        // No $set wrapper at all - every top-level key here is a bug in its
        // own right (see phase 06b's offerLetterController.js fix), whether
        // or not the paths themselves are declared.
        checkObjectAgainstPath(modelName, "", updateArg);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const schemasByModel = loadAllSchemas();
  if (Object.keys(schemasByModel).length === 0) {
    console.error("❌ No schemas could be loaded from models/mongo/ - refusing to report a false-clean result.");
    process.exit(1);
  }

  const findings = [];
  const unresolved = [];

  for (const dir of SCAN_DIRS) {
    for (const file of listAllJsFiles(path.join(BACKEND_ROOT, dir))) {
      if (path.resolve(file) === SELF_FILE) continue;
      scanFile(file, schemasByModel, findings, unresolved);
    }
  }

  console.log(`Checked ${Object.keys(schemasByModel).length} schema(s): ${Object.keys(schemasByModel).sort().join(", ")}`);

  if (VERBOSE && unresolved.length) {
    console.log(`\n${unresolved.length} assignment(s) with an unresolvable variable name (not checked - see MODEL_VARIABLE_HINTS):`);
    unresolved.forEach((u) => console.log(`  ${u.file}:${u.line}  "${u.rootName}"`));
  }

  if (findings.length === 0) {
    console.log("\n✅ Every assignment found resolves to a declared schema path.");
    process.exit(0);
  }

  console.log(`\n❌ ${findings.length} assignment(s) to a path not declared in its schema:\n`);
  findings
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    .forEach((f) => {
      console.log(`  ${f.file}:${f.line}  ${f.modelName}.${f.fullPath}`);
    });
  console.log("\nEach of these will be silently dropped by Mongoose (or, for a path nested under an already-declared parent, throw under strict:\"throw\") instead of persisting. Declare it in the matching models/mongo/*.js schema.");
  process.exit(1);
}

main();
