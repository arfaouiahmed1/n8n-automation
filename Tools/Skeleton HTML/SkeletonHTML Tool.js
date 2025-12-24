const puppeteer = require('puppeteer');

async function getHtmlSkeleton() {
  const url = $fromAI("url");
  const focusTag = $fromAI("focus_tag") || null;
  const searchText = $fromAI("search_text") || null;
  const interactiveOnly = $fromAI("interactive_only") !== false; // Default true
  const includeContext = $fromAI("include_context") !== false; // Default true

  if (!url) {
    return JSON.stringify({
      status: "error",
      message: "URL is required"
    });
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    
    // Block unnecessary resources for speed
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(1500); // Wait for dynamic content

    // Extract comprehensive interactive elements with context
    const interactiveElements = await page.evaluate((searchText) => {
      const elements = [];
      
      // Target interactive elements
      const candidates = document.querySelectorAll(
        'button, a, input[type="button"], input[type="submit"], ' +
        '[role="button"], [role="tab"], [onclick], ' +
        '[class*="btn"], [class*="button"], [class*="tab"], [class*="toggle"], ' +
        '[class*="load"], [class*="more"], [class*="show"], [class*="expand"], ' +
        '[data-toggle], [data-tab], [data-click]'
      );
      
      candidates.forEach((el, idx) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        
        // Check visibility
        const isVisible = rect.width > 0 && 
                         rect.height > 0 && 
                         style.display !== 'none' && 
                         style.visibility !== 'hidden' &&
                         parseFloat(style.opacity) > 0;
        
        if (!isVisible) return;
        
        const text = (el.textContent || '').trim();
        const tag = el.tagName.toLowerCase();
        
        // Apply text filter if provided
        if (searchText && !text.toLowerCase().includes(searchText.toLowerCase())) {
          return;
        }
        
        // Generate multiple selector options
        const selectors = [];
        
        if (el.id) {
          selectors.push({
            type: 'id',
            value: `#${el.id}`,
            reliability: 'high'
          });
        }
        
        const classes = el.className ? el.className.split(' ').filter(c => c.trim()) : [];
        if (classes.length > 0) {
          // Primary class
          selectors.push({
            type: 'class',
            value: `.${classes[0]}`,
            reliability: 'medium'
          });
          
          // Combined classes (more specific)
          if (classes.length > 1) {
            selectors.push({
              type: 'class_combined',
              value: `.${classes.slice(0, 3).join('.')}`,
              reliability: 'high'
            });
          }
        }
        
        // Tag + class
        if (classes.length > 0) {
          selectors.push({
            type: 'tag_class',
            value: `${tag}.${classes[0]}`,
            reliability: 'high'
          });
        }
        
        // Text-based selector (most reliable for dynamic content)
        if (text && text.length < 50) {
          selectors.push({
            type: 'text',
            value: `text=${text.slice(0, 40)}`,
            reliability: 'high'
          });
        }
        
        // Nth-of-type (fallback)
        const siblings = Array.from(el.parentElement?.children || []).filter(
          child => child.tagName === el.tagName
        );
        const position = siblings.indexOf(el) + 1;
        if (position > 0) {
          selectors.push({
            type: 'nth_type',
            value: `${tag}:nth-of-type(${position})`,
            reliability: 'low'
          });
        }
        
        // Get parent context
        let parentContext = '';
        let parent = el.parentElement;
        let depth = 0;
        while (parent && depth < 2) {
          const parentTag = parent.tagName.toLowerCase();
          const parentClass = parent.className ? `.${parent.className.split(' ')[0]}` : '';
          parentContext = `${parentTag}${parentClass} > ${parentContext}`;
          parent = parent.parentElement;
          depth++;
        }
        
        // Get siblings context (nearby text/elements)
        const siblingsText = [];
        if (el.parentElement) {
          Array.from(el.parentElement.children).forEach(sibling => {
            if (sibling !== el) {
              const sibText = (sibling.textContent || '').trim().slice(0, 30);
              if (sibText) siblingsText.push(sibText);
            }
          });
        }
        
        elements.push({
          index: idx,
          tag: tag,
          text: text.slice(0, 100),
          href: el.href || null,
          
          // Element properties
          id: el.id || null,
          classes: classes,
          attributes: {
            role: el.getAttribute('role'),
            type: el.getAttribute('type'),
            'data-toggle': el.getAttribute('data-toggle'),
            'data-tab': el.getAttribute('data-tab'),
            onclick: el.onclick ? 'present' : null,
            'aria-label': el.getAttribute('aria-label')
          },
          
          // Selector options ranked by reliability
          selectors: selectors,
          recommended_selector: selectors.length > 0 ? selectors[0].value : `${tag}:nth-of-type(${position})`,
          
          // Context for better understanding
          parent_context: parentContext.slice(0, 100),
          siblings_context: siblingsText.slice(0, 3),
          
          // Visibility and interactivity
          position: {
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          is_clickable: tag === 'a' || tag === 'button' || 
                       el.onclick !== null || 
                       el.getAttribute('role') === 'button' ||
                       style.cursor === 'pointer',
          
          // Purpose inference
          likely_purpose: inferPurpose(el, text)
        });
      });
      
      function inferPurpose(el, text) {
        const textLower = text.toLowerCase();
        const tag = el.tagName.toLowerCase();
        const href = el.href || '';
        
        // Navigation patterns
        if (textLower.match(/load|more|show|عرض|المزيد|expand|view all/)) {
          return 'load_more';
        }
        if (textLower.match(/next|previous|prev|التالي|السابق/)) {
          return 'pagination';
        }
        if (textLower.match(/today|tomorrow|date|calendar|اليوم|غدا/)) {
          return 'date_filter';
        }
        if (textLower.match(/live|ongoing|now|مباشر|الآن/)) {
          return 'live_filter';
        }
        if (textLower.match(/all|everything|كل|جميع/) && tag !== 'a') {
          return 'show_all';
        }
        
        // Tab/category patterns
        const classes = el.className || '';
        if (classes.match(/tab|nav-link|category/) || el.getAttribute('role') === 'tab') {
          return 'tab_navigation';
        }
        if (classes.match(/toggle|collapse|dropdown/)) {
          return 'toggle_content';
        }
        
        // Link patterns
        if (tag === 'a' && href) {
          if (textLower.match(/vs|v |match|game|مقابل|ضد/)) {
            return 'content_link';
          }
          if (href.includes('/live') || href.includes('/tv')) {
            return 'category_link';
          }
        }
        
        return 'unknown';
      }
      
      return elements;
    }, searchText);

    // Group elements by purpose for better organization
    const groupedByPurpose = interactiveElements.reduce((acc, el) => {
      const purpose = el.likely_purpose;
      if (!acc[purpose]) acc[purpose] = [];
      acc[purpose].push(el);
      return acc;
    }, {});

    // Generate recommendations
    const recommendations = [];
    
    if (groupedByPurpose.load_more?.length > 0) {
      recommendations.push({
        action: 'load_more',
        elements: groupedByPurpose.load_more.map(el => ({
          selector: el.recommended_selector,
          text: el.text,
          confidence: 'high'
        }))
      });
    }
    
    if (groupedByPurpose.tab_navigation?.length > 0) {
      recommendations.push({
        action: 'explore_tabs',
        elements: groupedByPurpose.tab_navigation.map(el => ({
          selector: el.recommended_selector,
          text: el.text,
          confidence: 'high'
        }))
      });
    }
    
    if (groupedByPurpose.show_all?.length > 0) {
      recommendations.push({
        action: 'show_all',
        elements: groupedByPurpose.show_all.map(el => ({
          selector: el.recommended_selector,
          text: el.text,
          confidence: 'medium'
        }))
      });
    }

    return JSON.stringify({
      status: "success",
      summary: {
        total_interactive: interactiveElements.length,
        by_purpose: Object.keys(groupedByPurpose).map(purpose => ({
          purpose,
          count: groupedByPurpose[purpose].length
        })),
        has_load_more: (groupedByPurpose.load_more?.length || 0) > 0,
        has_tabs: (groupedByPurpose.tab_navigation?.length || 0) > 0,
        has_filters: (groupedByPurpose.date_filter?.length || 0) > 0 || 
                     (groupedByPurpose.live_filter?.length || 0) > 0
      },
      recommendations: recommendations,
      interactive_elements: interactiveElements,
      grouped_by_purpose: groupedByPurpose,
      message: interactiveElements.length === 0 
        ? "No interactive elements found matching criteria" 
        : `Found ${interactiveElements.length} interactive elements`
    });

  } catch (error) {
    return JSON.stringify({
      status: "error",
      message: error.message,
      stack: error.stack
    });
  } finally {
    await browser.close();
  }
}

return await getHtmlSkeleton();