// Name: screenshot_tool_cloudinary
const puppeteer = require('puppeteer');
const https = require('https');

/**
 * Upload image buffer to Cloudinary
 */
async function uploadToCloudinary(imageBuffer) {
  const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "dktc34wxa";
  const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || "n8n-Ahmed";

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error(
      `Cloudinary credentials missing: CLOUD_NAME=${CLOUDINARY_CLOUD_NAME}, PRESET=${CLOUDINARY_UPLOAD_PRESET}`
    );
  }

  const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const formData = {
    file: base64Image,
    upload_preset: CLOUDINARY_UPLOAD_PRESET,
  };

  const boundary = "----n8nCloudinaryBoundary" + Math.random().toString(16).slice(2);
  let body = "";

  for (const [key, value] of Object.entries(formData)) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
    body += `${value}\r\n`;
  }
  body += `--${boundary}--\r\n`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.cloudinary.com",
        port: 443,
        path: `/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data).secure_url);
          } else {
            reject(new Error(`Cloudinary upload failed: ${data}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Main Screenshot Function
 */
async function takeScreenshot() {
  const url = $fromAI("url");
  const selector = $fromAI("selector");
  const fullPageInput = $fromAI("fullPage");
  const fullPage = fullPageInput === true || fullPageInput === "true";

  if (!url) {
    return JSON.stringify({
      status: "error",
      message: "URL is required",
    });
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(2000);

    let buffer;
    let type = "viewport";

    if (selector) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        const element = await page.$(selector);

        if (!element) {
          return JSON.stringify({
            status: "error",
            message: `Selector found but element is null: '${selector}'`,
          });
        }

        buffer = await element.screenshot();
        type = `element (${selector})`;
      } catch (err) {
        return JSON.stringify({
          status: "error",
          message: `Could not screenshot element '${selector}'. ${err.message}`,
        });
      }
    } else {
      buffer = await page.screenshot({ fullPage });
      type = fullPage ? "full_page" : "viewport";
    }

    const imageUrl = await uploadToCloudinary(buffer);

    return JSON.stringify({
      status: "success",
      type,
      image_url: imageUrl,
      message: "Screenshot uploaded successfully",
    });
  } catch (err) {
    return JSON.stringify({
      status: "error",
      message: err.message,
    });
  } finally {
    await browser.close();
  }
}

return await takeScreenshot();
