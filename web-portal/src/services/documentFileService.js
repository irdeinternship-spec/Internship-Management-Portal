const PDF_SIGNATURE = "%PDF-";

async function responseMessage(response) {
  const body = await response.clone().json().catch(() => null);
  if (body?.message) return body.message;

  const text = await response.text().catch(() => "");
  return text.slice(0, 200) || `Document request failed (${response.status}).`;
}

/**
 * Converts a successful document response to a verified Blob.  Keeping this
 * check here prevents JSON/HTML error pages from being opened as blank PDFs.
 */
export async function readDocumentResponse(response, expectedType = "application/pdf") {
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error("The generated document is empty.");
  if (expectedType && !contentType.toLowerCase().includes(expectedType.toLowerCase())) {
    throw new Error(`The server returned ${contentType || "an unknown format"}, not ${expectedType}.`);
  }

  if (expectedType === "application/pdf") {
    const signature = await blob.slice(0, PDF_SIGNATURE.length).text();
    if (signature !== PDF_SIGNATURE) {
      throw new Error("The server response is not a valid PDF document.");
    }
  }

  return blob.type ? blob : new Blob([blob], { type: expectedType || "application/octet-stream" });
}

export function createDocumentUrl(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("Cannot create a URL for an empty document.");
  return URL.createObjectURL(blob);
}

export function downloadDocument(blob, filename) {
  const url = createDocumentUrl(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "document";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Print from an off-screen frame so document actions never create a blank
// browser popup. The Blob URL remains live while the PDF viewer loads.
export function printPdf(blob) {
  const url = createDocumentUrl(blob);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed; width:0; height:0; border:0; opacity:0; pointer-events:none;";

  const cleanup = () => {
    window.clearTimeout(fallbackCleanup);
    frame.remove();
    URL.revokeObjectURL(url);
  };
  const fallbackCleanup = window.setTimeout(cleanup, 60_000);

  frame.onload = () => {
    const printWindow = frame.contentWindow;
    if (!printWindow) return cleanup();
    printWindow.addEventListener("afterprint", cleanup, { once: true });
    printWindow.focus();
    printWindow.print();
  };
  frame.src = url;
  document.body.appendChild(frame);
}
