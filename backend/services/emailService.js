const nodemailer = require("nodemailer");
const ActivityLog = require("../models/ActivityLog");

/**
 * EMAIL_ENABLED flag defaults to false.
 * Only enables real network dispatch when explicitly set to 'true'.
 */
function isEmailEnabled() {
  return process.env.EMAIL_ENABLED === "true";
}

/**
 * Writes an email dispatch record to ActivityLog when email is disabled or skipped.
 * Never throws.
 */
async function logEmailActivity({ recipient, subject, templateName, status = "Success" }) {
  try {
    await ActivityLog.create({
      userId: "system",
      userName: "System",
      role: "SYSTEM",
      module: "Email Service",
      action: "Send Email (Disabled)",
      recipient: recipient || "unknown",
      subject: subject || "unknown",
      templateName: templateName || "unknown",
      description: `Email sending skipped (EMAIL_ENABLED=false). Recipient: ${recipient || "unknown"}, Subject: "${subject || "unknown"}", Template: "${templateName || "unknown"}"`,
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to write email activity log:", err.message);
  }
}

function hasEmailConfig() {
  return Boolean(
    process.env.EMAIL_USER &&
    process.env.MAIL_FROM &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

let cachedTransporter = null;

async function createTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  if (!hasEmailConfig()) {
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: process.env.EMAIL_USER,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    },
  });

  return cachedTransporter;
}

async function sendOfferLetterEmail(student, attachment = {}) {
  const recipient = student?.email || "unknown";
  const subject = "DRDO Internship Offer Letter";
  const templateName = "Offer Letter";

  try {
    if (!isEmailEnabled()) {
      console.info(`📧 [EMAIL_DISABLED] Skipping sendOfferLetterEmail to ${recipient}`);
      await logEmailActivity({ recipient, subject, templateName });
      return {
        success: true,
        skipped: false,
        disabled: true,
        messageId: `disabled-${Date.now()}`,
      };
    }

    const transporter = await createTransporter();

    if (!transporter) {
      return {
        success: false,
        skipped: true,
        reason: "Email configuration missing.",
      };
    }

    const issueDate = student?.offerLetter?.issueDate
      ? new Date(student.offerLetter.issueDate).toLocaleDateString("en-IN")
      : student?.offerLetterUploadedDate
      ? new Date(student.offerLetterUploadedDate).toLocaleDateString("en-IN")
      : new Date().toLocaleDateString("en-IN");

    const pdfAttachment = attachment.buffer
      ? {
          filename: attachment.filename || "DRDO-Internship-Offer-Letter.pdf",
          content: attachment.buffer,
          contentType: "application/pdf",
        }
      : {
          filename: attachment.filename || "DRDO-Internship-Offer-Letter.pdf",
          path: attachment.url || student?.offerLetter?.url || student?.offerLetterUrl,
        };

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: student.email,
      subject,
      text: `Dear ${student.name},

Congratulations!

Your internship application has been approved. Please find your DRDO Internship Offer Letter attached.

Offer Letter Issue Date: ${issueDate}

Regards,
Internship Management Team`,
      attachments: [pdfAttachment],
    });

    return {
      success: true,
      skipped: false,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error("sendOfferLetterEmail error:", error.message);
    return {
      success: false,
      skipped: true,
      error: error.message,
    };
  }
}

async function sendRejectionEmail(student) {
  const recipient = student?.email || "unknown";
  const subject = "Internship Application Status";
  const templateName = "Rejection Email";

  try {
    if (!isEmailEnabled()) {
      console.info(`📧 [EMAIL_DISABLED] Skipping sendRejectionEmail to ${recipient}`);
      await logEmailActivity({ recipient, subject, templateName });
      return {
        success: true,
        skipped: false,
        disabled: true,
        messageId: `disabled-${Date.now()}`,
      };
    }

    const transporter = await createTransporter();

    if (!transporter) {
      return {
        success: false,
        skipped: true,
        reason: "Email configuration missing.",
      };
    }

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: student.email,
      subject,
      text: `Dear ${student.name},

We regret to inform you that your internship application has been rejected.

Remark:
${student.remark || "Please contact the administration for more information."}

Regards,
Internship Management Team`,
    });

    return {
      success: true,
      skipped: false,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error("sendRejectionEmail error:", error.message);
    return {
      success: false,
      skipped: true,
      error: error.message,
    };
  }
}

async function sendRegistrationConfirmationEmail(student) {
  const recipient = student?.email || "unknown";
  const subject = "DRDO Internship Registration Confirmation";
  const templateName = "Registration Confirmation";

  try {
    if (!isEmailEnabled()) {
      console.info(`📧 [EMAIL_DISABLED] Skipping sendRegistrationConfirmationEmail to ${recipient}`);
      await logEmailActivity({ recipient, subject, templateName });
      return {
        success: true,
        skipped: false,
        disabled: true,
        messageId: `disabled-${Date.now()}`,
      };
    }

    const transporter = await createTransporter();

    if (!transporter) {
      return {
        success: false,
        skipped: true,
        reason: "Email configuration missing.",
      };
    }

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: student.email,
      subject,
      text: `Dear ${student.name},

Your internship registration has been submitted successfully.

Application ID: ${student.referenceId}
Serial Number: ${student.serialNumber || "-"}

Please keep this Application ID safe. You will need your registered email address and Application ID to log in to the Student Portal.

Regards,
Internship Management Team`,
    });

    return {
      success: true,
      skipped: false,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error("sendRegistrationConfirmationEmail error:", error.message);
    return {
      success: false,
      skipped: true,
      error: error.message,
    };
  }
}

module.exports = {
  isEmailEnabled,
  sendOfferLetterEmail,
  sendRegistrationConfirmationEmail,
  sendRejectionEmail,
};