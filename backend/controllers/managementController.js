const service = require("../services/managementItemService");
const { logActivity } = require("../utils/activityLogger");

const type = (req) => req.params.type;

const getSuffix = (req) => {
  const t = type(req);
  return t.charAt(0).toUpperCase() + t.slice(1); // Branch, Course, Duration
};

exports.list = async (req, res, next) => {
  try { res.json(await service.list(type(req))); } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const item = await service.create(type(req), req.body.name, req.body.level);
    const suffix = getSuffix(req);
    await logActivity({
      req,
      module: "Management Module",
      action: `Added ${suffix}`,
      description: `Added new ${type(req)}: '${req.body.name}'.`,
      status: "Success",
    });
    res.status(201).json({ success: true, item });
  } catch (error) {
    const suffix = getSuffix(req);
    await logActivity({
      req,
      module: "Management Module",
      action: `Added ${suffix}`,
      description: `Failed to add ${type(req)}: '${req.body.name || "Unknown"}'. Error: ${error.message}`,
      status: "Failed",
    });
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try { res.json({ success: true, item: await service.update(type(req), req.params.id, req.body.name, req.body.level) }); } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try {
    const item = await service.remove(type(req), req.params.id);
    const suffix = getSuffix(req);
    await logActivity({
      req,
      module: "Management Module",
      action: `Deleted ${suffix}`,
      description: `Deleted ${type(req)}: '${item?.name || req.params.id}'.`,
      status: "Success",
    });
    res.json({ success: true, item });
  } catch (error) {
    const suffix = getSuffix(req);
    await logActivity({
      req,
      module: "Management Module",
      action: `Deleted ${suffix}`,
      description: `Failed to delete ${type(req)}. Error: ${error.message}`,
      status: "Failed",
    });
    next(error);
  }
};
