const nodemailer = require("nodemailer");

// Configure the SMTP transporter (Works with Brevo, Resend, Mailgun, etc.)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Add this block to bypass the local certificate error
  tls: {
    rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : false
  }
});

/**
 * Reusable Email Service with a Clean HTML Template
 */
const sendEmail = async ({ to, subject, title, body, ctaText, ctaUrl }) => {
  const htmlTemplate = `
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5; margin: 0; padding: 0; }
      .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
      .header { background-color: #4F46E5; padding: 30px 20px; text-align: center; color: #ffffff; }
      .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
      .content { padding: 30px; color: #374151; line-height: 1.6; font-size: 16px; }
      .button-container { text-align: center; margin: 30px 0; }
      .button { background-color: #4F46E5; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; }
      .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #9ca3af; font-size: 14px; border-top: 1px solid #e5e7eb; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>${title}</h1>
      </div>
      <div class="content">
        ${body}
        ${ctaText && ctaUrl ? `
        <div class="button-container">
          <a href="${ctaUrl}" class="button">${ctaText}</a>
        </div>
        ` : ''}
      </div>
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} Novel Angel. All rights reserved.</p>
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: `"Novel Angel" <${process.env.EMAIL_FROM}>`, // e.g., noreply@yourapp.com
    to,
    subject,
    html: htmlTemplate,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: " + info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Error sending email: ", error);
    return { success: false, error: error.message };
  }
};

module.exports = { sendEmail };