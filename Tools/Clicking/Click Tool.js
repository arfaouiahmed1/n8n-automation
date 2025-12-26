const puppeteer = require('puppeteer');

async function smartClick() {
  const url = $fromAI("url");
  const selector = $fromAI("selector");
  const expectNavigation = $fromAI("expect_navigation") === true;

  if (!url || !selector) {
    return JSON.stringify({
      status: "error",
      message: "URL and selector are required"
    });
  }

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--no-first-run',
      '--disable-background-networking',
      '--disable-default-apps',
      '--mute-audio',
      '--headless=new',
      '--disable-extensions-except=/data/extensions/ublock',
      '--load-extension=/data/extensions/ublock'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    // Navigate to page
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForTimeout(2000); // Wait for dynamic content
    
    const beforeUrl = page.url();

    // Get snapshot of content URLs before click
    const beforeLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      return links
        .map(a => a.href)
        .filter(href => href && !href.startsWith('javascript:') && href !== '#');
    });

    // Count content indicators before click
    const beforeContentCount = await page.evaluate(() => {
      const contentPatterns = [
        'vs', 'v ', 'مقابل', 'ضد', 'match', 'live', 'stream',
        'game', 'watch', 'event', 'show', 'fight', 'race'
      ];
      const elements = document.querySelectorAll('a[href], div[class*="match"], div[class*="game"], div[class*="event"]');
      let count = 0;
      
      elements.forEach(el => {
        const text = (el.textContent || '').toLowerCase();
        const href = (el.href || '').toLowerCase();
        const className = (el.className || '').toLowerCase();
        
        if (contentPatterns.some(p => 
          text.includes(p) || href.includes(p) || className.includes(p)
        )) {
          count++;
        }
      });
      
      return count;
    });

    // ENHANCED CLICK LOGIC
    let clickSuccess = false;
    let clickMethod = '';
    let errorLog = [];
    let elementInfo = null;

    // METHOD 1: Text-based selector
    if (selector.startsWith('text=')) {
      const text = selector.slice(5).trim();
      const textLower = text.toLowerCase();
      
      try {
        // Try direct click in browser context (most reliable)
        const clickResult = await page.evaluate((searchText, searchTextLower) => {
          const allElements = document.querySelectorAll('a, button, [role="button"], div[onclick], span[onclick], [class*="btn"], [class*="tab"]');
          const matches = [];
          
          allElements.forEach((el) => {
            const elementText = (el.textContent || '').trim();
            const elementTextLower = elementText.toLowerCase();
            
            // Match strategies
            const exactMatch = elementTextLower === searchTextLower;
            const containsMatch = elementTextLower.includes(searchTextLower);
            const wordMatch = elementTextLower.split(/\\s+/).some(word => word === searchTextLower);
            
            if (exactMatch || containsMatch || wordMatch) {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              const visible = rect.width > 0 && rect.height > 0 &&
                            style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            parseFloat(style.opacity) > 0;
              
              if (visible) {
                const classes = el.className ? el.className.split(' ').filter(c => c) : [];
                matches.push({
                  element: el,
                  tag: el.tagName.toLowerCase(),
                  text: elementText.slice(0, 100),
                  id: el.id || null,
                  classes: classes,
                  matchType: exactMatch ? 'exact' : (wordMatch ? 'word' : 'contains'),
                  clickable: ['a', 'button'].includes(el.tagName.toLowerCase()) ||
                            el.onclick !== null ||
                            el.getAttribute('role') === 'button' ||
                            style.cursor === 'pointer',
                  rect: {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height
                  }
                });
              }
            }
          });
          
          // Sort by match quality
          matches.sort((a, b) => {
            const matchScore = { exact: 3, word: 2, contains: 1 };
            const scoreA = matchScore[a.matchType] + (a.clickable ? 10 : 0);
            const scoreB = matchScore[b.matchType] + (b.clickable ? 10 : 0);
            return scoreB - scoreA;
          });
          
          if (matches.length === 0) {
            return { success: false, error: 'No matching elements found', matches: [] };
          }
          
          // Try clicking the best matches
          for (const match of matches.slice(0, 3)) {
            try {
              // Scroll into view
              match.element.scrollIntoView({ behavior: 'instant', block: 'center' });
              
              // Try click
              match.element.click();
              
              return {
                success: true,
                matchType: match.matchType,
                elementInfo: {
                  tag: match.tag,
                  text: match.text,
                  id: match.id,
                  classes: match.classes,
                  clickable: match.clickable,
                  rect: match.rect
                },
                totalMatches: matches.length
              };
            } catch (e) {
              // Continue to next match
              continue;
            }
          }
          
          // If all clicks failed, return info about matches
          return {
            success: false,
            error: `Found ${matches.length} matches but all click attempts failed`,
            matches: matches.map(m => ({
              tag: m.tag,
              text: m.text,
              matchType: m.matchType,
              clickable: m.clickable
            }))
          };
        }, text, textLower);
        
        if (clickResult.success) {
          clickSuccess = true;
          clickMethod = `text_${clickResult.matchType}_direct`;
          elementInfo = clickResult.elementInfo;
          errorLog.push(`Successfully clicked using direct method (${clickResult.totalMatches} matches found)`);
        } else {
          errorLog.push(clickResult.error);
          if (clickResult.matches && clickResult.matches.length > 0) {
            errorLog.push(`Available matches: ${clickResult.matches.map(m => `"${m.text}" (${m.matchType})`).join(', ')}`);
          }
          
          // Provide similar text suggestions
          const similarTexts = await page.evaluate((searchTextLower) => {
            const allElements = document.querySelectorAll('a, button, [role="button"], div[onclick]');
            const suggestions = [];
            
            allElements.forEach(el => {
              const text = (el.textContent || '').trim();
              const rect = el.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0;
              
              if (visible && text.length > 0 && text.length < 100) {
                suggestions.push(text);
              }
            });
            
            return [...new Set(suggestions)].slice(0, 20);
          }, textLower);
          
          errorLog.push(`Available clickable texts: ${similarTexts.slice(0, 10).join(', ')}`);
        }
      } catch (e) {
        errorLog.push(`Text search failed: ${e.message}`);
      }
    }
    
    // METHOD 2: CSS Selector with enhanced validation
    else {
      // Try to find and validate element first
      try {
        const elementExists = await page.evaluate((sel) => {
          try {
            const el = document.querySelector(sel);
            if (!el) return { found: false };
            
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            
            return {
              found: true,
              visible: rect.width > 0 && rect.height > 0,
              display: style.display !== 'none',
              visibility: style.visibility !== 'hidden',
              opacity: parseFloat(style.opacity),
              tag: el.tagName.toLowerCase(),
              text: el.textContent.trim().slice(0, 100),
              isInteractive: ['a', 'button', 'input'].includes(el.tagName.toLowerCase()) ||
                            el.onclick !== null ||
                            el.hasAttribute('onclick') ||
                            el.getAttribute('role') === 'button' ||
                            style.cursor === 'pointer'
            };
          } catch (e) {
            return { found: false, error: e.message };
          }
        }, selector);

        if (!elementExists.found) {
          errorLog.push(`Element not found: ${selector}`);
        } else if (!elementExists.visible) {
          errorLog.push(`Element found but not visible: ${JSON.stringify(elementExists)}`);
        } else {
          elementInfo = elementExists;
          
          // Try direct click
          try {
            await page.waitForSelector(selector, { visible: true, timeout: 2000 });
            await page.click(selector);
            clickSuccess = true;
            clickMethod = 'css_direct';
          } catch (e1) {
            errorLog.push(`Direct click failed: ${e1.message}`);
            
            // Try scrolling into view then click
            try {
              await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, selector);
              await page.waitForTimeout(500);
              await page.click(selector);
              clickSuccess = true;
              clickMethod = 'css_scroll_click';
            } catch (e2) {
              errorLog.push(`Scroll + click failed: ${e2.message}`);
              
              // Try JavaScript click as last resort
              try {
                const jsClicked = await page.evaluate((sel) => {
                  const el = document.querySelector(sel);
                  if (el) {
                    el.click();
                    return true;
                  }
                  return false;
                }, selector);
                
                if (jsClicked) {
                  clickSuccess = true;
                  clickMethod = 'js_click';
                } else {
                  errorLog.push('JS click: element not found');
                }
              } catch (e3) {
                errorLog.push(`JS click failed: ${e3.message}`);
              }
            }
          }
        }
      } catch (e) {
        errorLog.push(`Element validation failed: ${e.message}`);
      }
    }

    // If click failed, provide better alternatives
    if (!clickSuccess) {
      const suggestions = await page.evaluate((failedSelector) => {
        const keywords = [
          'load', 'more', 'show', 'all', 'view', 'expand',
          'عرض', 'المزيد', 'الكل', 'اليوم', 'مباشر',
          'today', 'live', 'upcoming', 'schedule'
        ];
        
        const elements = Array.from(document.querySelectorAll(
          'button, a, div[role="button"], span[onclick], [class*="btn"], [class*="toggle"], [class*="tab"], [class*="nav"]'
        ));
        
        const matches = [];
        
        elements.forEach((el, idx) => {
          const text = (el.textContent || '').toLowerCase().trim();
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const isVisible = rect.width > 0 && rect.height > 0 && 
                          style.display !== 'none' && 
                          style.visibility !== 'hidden';
          
          if (isVisible && keywords.some(kw => text.includes(kw))) {
            const classes = el.className ? el.className.split(' ').filter(c => c) : [];
            
            matches.push({
              tag: el.tagName.toLowerCase(),
              text: el.textContent.trim().slice(0, 60),
              id: el.id,
              classes: classes.slice(0, 3),
              suggested_selector: el.id ? `#${el.id}` : 
                                classes.length > 0 ? `.${classes[0]}` :
                                `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`,
              text_selector: `text=${text.slice(0, 30)}`
            });
          }
        });
        
        return matches.slice(0, 5);
      }, selector);

      return JSON.stringify({
        status: "error",
        message: `Failed to click selector after ${errorLog.length} attempts`,
        selector_tried: selector,
        element_info: elementInfo,
        attempts: errorLog,
        suggestions: suggestions,
        hint: suggestions.length > 0 ? 
              `Most likely: ${suggestions[0].suggested_selector} (${suggestions[0].text})` : 
              "No interactive elements found - page may be loading or selector is incorrect"
      });
    }

    // Wait for changes based on expectation
    if (expectNavigation) {
      try {
        await page.waitForNavigation({ timeout: 5000, waitUntil: 'networkidle0' });
      } catch {
        await page.waitForTimeout(3000);
      }
    } else {
      await page.waitForTimeout(2000);
    }

    const afterUrl = page.url();
    const navigated = beforeUrl !== afterUrl;

    // Get snapshot of content URLs after click
    const afterLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      return links
        .map(a => a.href)
        .filter(href => href && !href.startsWith('javascript:') && href !== '#');
    });

    // Calculate new unique links
    const beforeSet = new Set(beforeLinks);
    const newLinks = afterLinks.filter(link => !beforeSet.has(link));

    // Count content indicators after click
    const afterContentCount = await page.evaluate(() => {
      const contentPatterns = [
        'vs', 'v ', 'مقابل', 'ضد', 'match', 'live', 'stream',
        'game', 'watch', 'event', 'show', 'fight', 'race'
      ];
      const elements = document.querySelectorAll('a[href], div[class*="match"], div[class*="game"], div[class*="event"]');
      let count = 0;
      
      elements.forEach(el => {
        const text = (el.textContent || '').toLowerCase();
        const href = (el.href || '').toLowerCase();
        const className = (el.className || '').toLowerCase();
        
        if (contentPatterns.some(p => 
          text.includes(p) || href.includes(p) || className.includes(p)
        )) {
          count++;
        }
      });
      
      return count;
    });

    // Check if meaningful content appeared
    const contentIncreased = afterContentCount > beforeContentCount;
    const newLinksAppeared = newLinks.length > 0;
    
    // Extract sample of new visible content
    const newContentSample = await page.evaluate(() => {
      const contentPatterns = [
        'vs', 'v ', 'مقابل', 'ضد', 'match', 'live', 'stream',
        'game', 'watch', 'event', 'show', 'fight'
      ];
      
      const links = Array.from(document.querySelectorAll('a[href]'));
      const samples = [];
      
      links.forEach(link => {
        const text = link.textContent.trim();
        const href = link.href;
        
        if (text && contentPatterns.some(p => 
          text.toLowerCase().includes(p) || href.toLowerCase().includes(p)
        )) {
          samples.push({
            text: text.slice(0, 80),
            href: href
          });
        }
      });
      
      return samples.slice(0, 10);
    });

    return JSON.stringify({
      status: "success",
      selector_clicked: selector,
      click_method: clickMethod,
      element_clicked: elementInfo,
      navigated,
      url_changed: navigated,
      previous_url: beforeUrl,
      current_url: afterUrl,
      
      // More accurate metrics
      content_elements_before: beforeContentCount,
      content_elements_after: afterContentCount,
      content_increased: contentIncreased,
      content_delta: afterContentCount - beforeContentCount,
      
      // Link tracking
      total_links_before: beforeLinks.length,
      total_links_after: afterLinks.length,
      new_unique_links: newLinks.length,
      new_links_sample: newLinks.slice(0, 5),
      
      // Content samples
      visible_content_sample: newContentSample,
      
      // Decision helper
      likely_successful: navigated || contentIncreased || newLinksAppeared,
      recommendation: navigated ? "Navigation occurred - refresh page data" :
                      contentIncreased ? "New content appeared - extract from current page" :
                      newLinksAppeared ? "New links appeared - may need extraction" :
                      "No significant changes detected - try different selector"
    });

  } catch (error) {
    return JSON.stringify({
      status: "error",
      message: error.message,
      stack: error.stack,
      selector_tried: selector
    });
  } finally {
    await browser.close();
  }
}

return await smartClick();