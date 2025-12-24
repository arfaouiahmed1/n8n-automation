// n8n Code node (JavaScript) - Cheerio + html-minifier-terser + Cloudinary implementation
// Paste into a JavaScript Code node. Requires installed packages:
//   npm install cheerio html-minifier-terser cloudinary
// (You said html-minifier-terser is already installed.)

const cheerio = require('cheerio');
const { minify } = require('html-minifier-terser');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary (ensure n8n environment variables are set):
// CLOUDINARY_CLOUD_NAME
// CLOUDINARY_API_KEY
// CLOUDINARY_API_SECRET
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const URL_EXTRACTOR = /https?:\/\/[^\s"'<>]+/g;
const URL_VALIDATOR = new RegExp(
  '^(https?:\\/\\/)?' +
    "(?:www\\.)?" +
    '[-a-zA-Z0-9@:%._\\+~#=]{1,256}' +
    '\\.[a-zA-Z0-9()]{1,6}\\b' +
    '(?:[-a-zA-Z0-9()@:%_\\+.~#?&\\/=]*)$'
);

function isValidUrl(url) {
  return Boolean(URL_VALIDATOR.test(url));
}

async function getCleanedHtml(soupHtml) {
  // prefer body only if exists
  try {
    const minified = await minify(soupHtml, {
      collapseWhitespace: true,
      removeComments: true,
      removeAttributeQuotes: false,
      keepClosingSlash: true,
      minifyCSS: true,
      minifyJS: true,
      removeRedundantAttributes: true,
      removeEmptyAttributes: false,
      conservativeCollapse: true,
      collapseBooleanAttributes: true,
      sortAttributes: true,
      sortClassName: true,
    });
    return minified;
  } catch (e) {
    // fallback
    return soupHtml;
  }
}

/**
 * Upload screenshot to Cloudinary
 * @param {string} screenshotUrl - URL or base64 data of screenshot
 * @param {string} pageUrl - Original page URL for folder organization
 * @returns {Promise<{success: boolean, url: string, publicId: string, error?: string}>}
 */
async function uploadScreenshotToCloudinary(screenshotUrl, pageUrl = '') {
  try {
    if (!screenshotUrl) {
      return { success: false, url: '', publicId: '', error: 'No screenshot URL provided' };
    }

    // Generate a public ID from page URL or timestamp
    const timestamp = new Date().toISOString().replace(/[:\-]/g, '').split('.')[0];
    let publicId = `website-screenshots/${timestamp}`;
    
    if (pageUrl) {
      try {
        const urlObj = new URL(pageUrl);
        const domain = urlObj.hostname.replace(/^www\./, '');
        publicId = `website-screenshots/${domain}/${timestamp}`;
      } catch (e) {
        // fallback to default if URL parsing fails
      }
    }

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(screenshotUrl, {
      resource_type: 'auto',
      public_id: publicId,
      folder: 'website-screenshots',
      quality: 'auto:good',
      format: 'webp', // convert to webp for optimization
      eager: [
        { quality: 'auto', fetch_format: 'auto' },
        { width: 300, height: 200, crop: 'fill', quality: 'auto' }, // thumbnail
      ],
      tags: ['website-screenshot', pageUrl ? pageUrl.split('/')[2] : 'unknown'],
    });

    return {
      success: true,
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      thumbnail: uploadResult.eager && uploadResult.eager[1] ? uploadResult.eager[1].secure_url : uploadResult.secure_url,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
    };
  } catch (e) {
    return {
      success: false,
      url: screenshotUrl, // fallback to original URL
      publicId: '',
      error: e.message || 'Failed to upload to Cloudinary',
    };
  }
}

function extractScriptUrlsFromCheerio($) {
  const urls = [];
  $('script').each((i, el) => {
    const txt = $(el).html() || $(el).text() || '';
    let m;
    while ((m = URL_EXTRACTOR.exec(txt))) {
      urls.push(m[0]);
    }
  });
  return urls;
}

function removeUnwantedTags($, { removeScripts = true, removeStyles = true, excludedTags = [] } = {}) {
  const tagsToRemove = new Set(excludedTags || []);
  if (removeScripts) tagsToRemove.add('script');
  if (removeStyles) tagsToRemove.add('style');
  for (const t of tagsToRemove) {
    $(t).remove();
  }
}

function removeTagsWithAttributes($, excludedAttributes = []) {
  if (!excludedAttributes || excludedAttributes.length === 0) return;
  const selector = '*';
  $(selector).each((i, el) => {
    const attribs = el.attribs || {};
    for (const attr of excludedAttributes) {
      if (Object.prototype.hasOwnProperty.call(attribs, attr)) {
        $(el).remove();
        break;
      }
    }
  });
}

function processImages($, { keepImages = false, removeSvg = true, removeGif = true, excludedImageTypes = [] } = {}) {
  if (!keepImages) {
    $('img').remove();
    return;
  }
  // build extensions set
  const removeExts = new Set((excludedImageTypes || []).map((e) => (e.startsWith('.') ? e.toLowerCase() : '.' + e.toLowerCase())));
  if (removeSvg) removeExts.add('.svg');
  if (removeGif) removeExts.add('.gif');

  $('img').each((i, el) => {
    const src = (el.attribs && (el.attribs.src || el.attribs['data-src'] || '')) || '';
    const lower = src.toLowerCase();
    let remove = false;
    for (const ext of removeExts) {
      if (lower.endsWith(ext)) {
        remove = true;
        break;
      }
    }
    if (remove || !src) {
      $(el).remove();
    } else {
      // replace img with plain text marker to preserve in text extraction
      $(el).replaceWith(`\n[IMAGE: ${src}]\n`);
    }
  });
}

function processLinks($) {
  const links = [];
  $('a').each((i, el) => {
    const href = (el.attribs && (el.attribs.href || '')).trim();
    if (!href) return;
    let normalized = href;
    if (normalized.startsWith('//')) normalized = 'https:' + normalized;
    const text = $(el).text().trim();
    const title = (el.attribs && el.attribs.title) ? el.attribs.title.trim() : undefined;
    const parent = $(el).parent();
    const parentText = parent ? parent.text().trim() : undefined;
    const linkData = { url: normalized };
    if (text) linkData.text = text;
    if (title) linkData.title = title;
    if (parentText) linkData.parent_text = parentText;
    links.push(linkData);
  });
  return links;
}

function removeAllLinks($) {
  $('a').remove();
}

function extractVisibleTextFromHtml(html) {
  // Use Cheerio to get text; keep line breaks a bit
  const $ = cheerio.load(html, { decodeEntities: false });
  const text = $('body').text() || $.root().text();
  // normalize whitespace
  return text.replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function detectMetaDescription($) {
  const metaDesc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
  return metaDesc ? metaDesc.trim() : '';
}

function detectSuspiciousPatterns(html) {
  const patterns = [];
  if (/document\.write\(/i.test(html)) patterns.push('document.write');
  if (/eval\(/i.test(html)) patterns.push('eval');
  if (/base64,/.test(html)) patterns.push('base64');
  if (/data:\s*image\/svg\+xml/i.test(html)) patterns.push('inline-svg-data');
  if (/javascript:/i.test(html)) patterns.push('javascript:links');
  if (/<iframe\s+[^>]*src=["']?data:/i.test(html)) patterns.push('iframe-data-src');
  // long inline scripts
  const scriptMatches = html.match(/<script\b[^>]*>([\s\S]{200,})<\/script>/i);
  if (scriptMatches) patterns.push('long-inline-script');
  return patterns;
}

function detectSuspiciousPlayers(html) {
  const players = new Set();
  const pCandidates = ['jwplayer', 'videojs', 'plyr', 'hls', 'dash', 'youtube', 'vimeo', 'brightcove', 'wistia'];
  const lower = html.toLowerCase();
  for (const p of pCandidates) {
    if (lower.includes(p)) players.add(p);
  }
  return Array.from(players);
}

function detectKeywords(text, maxKeywords = 10) {
  if (!text) return [];
  // simple tokenization and frequency counting with stopwords
  const stopwords = new Set([
    'the','and','a','to','of','in','is','it','you','that','he','was','for','on','are','as','with','his','they','i','at','be',
    'this','have','from','or','one','had','by','word','but','not','what','all','were','we','when','your','can','said','there',
    'use','each','which','she','do','how','their','if','will','up','other','about','out','many','then','them','these','so',
    'some','her','would','make','like','him','into','time','has','look','two','more','write','go','see','number','no','way',
    'could','people','my','than','first','water','been','call','who','oil','its','now','find','long','down','day','did','get',
    'come','made','may','part'
  ]);
  const tokens = text
    .replace(/[\W_]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length > 2 && !stopwords.has(t));
  if (tokens.length === 0) return [];
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, maxKeywords);
  return sorted.map((s) => s[0]);
}

// rank iframes: prefer same-origin, then longer html; input children[] from your JSON
function rankIframes(iframes = []) {
  if (!Array.isArray(iframes) || iframes.length === 0) return [];
  const scored = iframes.map((fr) => {
    let score = 0;
    if (fr.type && fr.type.toLowerCase().includes('same-origin')) score += 10;
    const htmlLen = (fr.html || '').length || 0;
    score += Math.min(10, Math.floor(htmlLen / 200));
    return { iframe: fr.url || fr.embedUrl || fr.url || null, iframe_html: fr.html || fr.html || '', score, raw: fr };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// Main processing function that mirrors process_html_content and extract_features_from_html
async function processHtmlContent(htmlContent, opts = {}) {
  // opts: parser not used (cheerio), keep_images, remove_svg, remove_gif, excluded_image_types,
  // keep_links, remove_scripts, remove_styles, excluded_tags, excluded_attributes, return_html
  const {
    keep_images = false,
    remove_svg = true,
    remove_gif = true,
    excluded_image_types = [],
    keep_links = true,
    remove_scripts = true,
    remove_styles = true,
    excluded_tags = [],
    excluded_attributes = [],
    return_html = false,
  } = opts || {};

  try {
    const $ = cheerio.load(htmlContent || '', { decodeEntities: false });

    // Extract script URLs before removing scripts (if requested)
    const scriptUrls = remove_scripts ? extractScriptUrlsFromCheerio($) : [];

    // Remove tags with attributes first if requested
    if (excluded_attributes && excluded_attributes.length > 0) removeTagsWithAttributes($, excluded_attributes);

    // Remove unwanted tags
    removeUnwantedTags($, { removeScripts: remove_scripts, removeStyles: remove_styles, excludedTags: excluded_tags });

    // Process images
    processImages($, { keepImages: keep_images, removeSvg: remove_svg, removeGif: remove_gif, excludedImageTypes: excluded_image_types });

    // Process links
    let pageLinks = [];
    if (keep_links) {
      pageLinks = processLinks($);
    } else {
      removeAllLinks($);
    }

    // Get cleaned HTML (body preferred)
    const body = $('body').length ? $('body').html() : $.root().html();
    const cleaned_html = await getCleanedHtml(body || '');
    const text_content = extractVisibleTextFromHtml(cleaned_html);

    return {
      cleaned_html: return_html ? cleaned_html : '',
      text_content,
      script_urls: Array.from(new Set(scriptUrls)),
      page_links: pageLinks,
    };
  } catch (e) {
    // on error return empty structure
    return {
      cleaned_html: '',
      text_content: '',
      script_urls: [],
      page_links: [],
    };
  }
}

async function extractFeaturesFromHtml(data = {}) {
  // be tolerant of different key names
  const pageContent = data.pageContent || data.page_content || data.html || data.page_content || '';
  const layout = data.layout || { hasHeader: !!data.header_in_html, hasFooter: !!data.footer_in_html, hasNav: !!data.nav_in_html };
  const network = data.network || data.page_network || [];
  const iframes = data.iframes || data.children || [];
  const mainUrl = data.mainUrl || data.url || data.main_url || '';
  let screenshotUrl = data.screenshotUrl || data.screenshot_url || '';

  // page_features: process main page HTML (exclude footer by default like original)
  const page_features = await processHtmlContent(pageContent, { excluded_tags: ['footer'] });

  // rank iframes and pick top
  const ranked = rankIframes(iframes);
  const topIframe = ranked.length ? ranked[0] : null;
  const iframeRaw = topIframe ? topIframe.raw : null;

  // process iframe html if present
  let iframe_html = null;
  if (topIframe && topIframe.iframe_html) {
    const processed_iframe_html = await processHtmlContent(topIframe.iframe_html, { return_html: true });
    iframe_html = processed_iframe_html.cleaned_html || '';
    // enrich page_links with iframe links
    if (processed_iframe_html.page_links && processed_iframe_html.page_links.length) {
      page_features.page_links = page_features.page_links.concat(processed_iframe_html.page_links);
    }
  } else if (iframeRaw && iframeRaw.html) {
    // fallback: process raw.html
    const processed_iframe_html = await processHtmlContent(iframeRaw.html, { return_html: true });
    iframe_html = processed_iframe_html.cleaned_html || '';
    if (processed_iframe_html.page_links && processed_iframe_html.page_links.length) {
      page_features.page_links = page_features.page_links.concat(processed_iframe_html.page_links);
    }
  }

  const contentText = page_features.text_content || '';
  const $main = cheerio.load(pageContent || '', { decodeEntities: false });
  const visible_text = $main.text().replace(/\s+/g, ' ').trim();

  const meta_description = detectMetaDescription($main);
  const patterns = detectSuspiciousPatterns(pageContent || '');
  const players = detectSuspiciousPlayers(pageContent || '');
  const keywords = detectKeywords(visible_text);

  const page_links = page_features.page_links || [];

  // Upload screenshot to Cloudinary if provided
  if (screenshotUrl) {
    try {
      const uploadResult = await uploadScreenshotToCloudinary(screenshotUrl, mainUrl);
      // Use Cloudinary URL if upload was successful
      if (uploadResult.success) {
        screenshotUrl = uploadResult.url;
      } else {
        // If upload fails, try to keep original URL if it's valid
        if (!screenshotUrl.startsWith('http')) {
          screenshotUrl = '';
        }
      }
    } catch (e) {
      console.error('Screenshot upload error:', e.message);
      // Keep original URL on error, or empty if invalid
      if (!screenshotUrl.startsWith('http')) {
        screenshotUrl = '';
      }
    }
  } else {
    screenshotUrl = '';
  }

  return {
    mainUrl: mainUrl || null,
    page_links,
    page_text_content: page_features.text_content || '',
    page_has_header: layout.hasHeader || layout.header_in_html || false,
    page_has_footer: layout.hasFooter || layout.footer_in_html || false,
    page_has_navbar: layout.hasNav || layout.nav_in_html || false,
    page_network: network,
    players_found: players,
    iframe: topIframe ? (topIframe.iframe || (iframeRaw && (iframeRaw.embedUrl || iframeRaw.url)) || '') : '',
    iframe_html: iframe_html || '',
    suspicious_patterns: patterns,
    meta_description,
    keywords,
    screenshot_url: screenshotUrl || null,
  };
}

// n8n Code node main
// items is provided by n8n runtime. We will map each input item to a feature-extracted JSON
// If you feed a single JSON input (like your output.json array), ensure you pass it correctly into the node
async function main() {
  // `items` is a global variable inside n8n Code node environment
  // but to be safe, attempt to read it from input
  const inputItems = items && items.length ? items : (Array.isArray($input?.all()) ? $input.all() : []);

  const results = [];
  for (let idx = 0; idx < inputItems.length; idx++) {
    const item = inputItems[idx];
    const inputJson = item.json || item;
    // If the user passed an array (like your output.json top-level array), handle it:
    if (Array.isArray(inputJson) && inputJson.length === 1) {
      // if array of single element, unwrap
      const features = await extractFeaturesFromHtml(inputJson[0]);
      results.push(features);
    } else if (Array.isArray(inputJson) && inputJson.length > 1 && typeof inputJson[0] === 'object') {
      // if they passed a whole array of pages, produce a features entry per array element
      for (const el of inputJson) {
        const features = await extractFeaturesFromHtml(el);
        results.push(features);
      }
    } else {
      // normal single object input
      const features = await extractFeaturesFromHtml(inputJson);
      results.push(features);
    }
  }

  // return results mapped into n8n expected format
  return results.map((r) => ({ json: r }));
}

// run main and return
return main();
