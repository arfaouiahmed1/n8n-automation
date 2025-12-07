import sys
import json

# Simple test script
print(json.dumps({"message": "Hello from Python!", "version": sys.version}))
from bs4 import BeautifulSoup
from minify_html import minify
from inscriptis import get_text
from typing import Dict, List, Optional
import re
import logging
import subprocess
import json
# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(_name_)

URL_EXTRACTOR = re.compile(r'https?://[^\s"\'<>]+')

URL_VALIDATOR = re.compile(
    r"^(https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}"
    r"\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)$"
)

def is_valid_url(url: str) -> bool:
    return bool(URL_VALIDATOR.match(url))



def process_html_content(
    html_content: str,
    parser: str = "lxml",
    keep_images: bool = False,
    remove_svg: bool = True,
    remove_gif: bool = True,
    excluded_image_types: Optional[List[str]] = None,
    keep_links: bool = True,
    remove_scripts: bool = True,
    remove_styles: bool = True,
    excluded_tags: Optional[List[str]] = None,
    excluded_attributes: Optional[List[str]] = None,
    return_html=False
) -> Dict[str, any]:
    """
    Process HTML content and extract cleaned HTML, text, and URLs.
    
    Args:
        html_content: Raw HTML string to process
        parser: BeautifulSoup parser to use ('lxml', 'html.parser', etc.)
        keep_images: Whether to preserve image tags
        remove_svg: Remove SVG images
        remove_gif: Remove GIF images
        excluded_image_types: List of image file extensions to remove
        keep_links: Whether to preserve link information
        remove_scripts: Remove script tags
        remove_styles: Remove style tags
        excluded_tags: Additional tags to remove
        excluded_attributes: Additional Attributes to 
        return_html: render html text or skip
    Returns:
        Dictionary containing:
        - cleaned_html: Minified HTML content
        - text_content: Plain text extracted from HTML
        - script_urls: URLs found in script tags
        - page_links: Links found in the page
    """
    # Initialize default values
    excluded_image_types = excluded_image_types or []
    excluded_tags = excluded_tags or []
    excluded_attributes = excluded_attributes or []

    # Initialize result containers
    script_urls = []
    page_links = []
    
    try:
        # Parse HTML
        soup = BeautifulSoup(html_content, parser)
        # Extract URLs from script tags before removal
        if remove_scripts:
            script_urls = _extract_script_urls(soup)
        if excluded_attributes:
            _remove_tags_with_attributes(soup, excluded_attributes)
        # Remove unwanted tags
        _remove_unwanted_tags(soup, remove_scripts, remove_styles, excluded_tags)
        
        # Process images
        _process_images(soup, keep_images, remove_svg, remove_gif, excluded_image_types)
        
        # Process links
        if keep_links:
            page_links = _process_links(soup)
        else:
            _remove_all_links(soup)
        
        # Extract final content
        cleaned_html = _get_cleaned_html(soup)
        text_content = get_text(cleaned_html)
        processed = {
            "text_content": text_content,
            "script_urls": list(set(script_urls)),  # Remove duplicates
            "page_links": page_links,
            "cleaned_html": cleaned_html if return_html else ""
        }
        return processed
    except Exception as e:
        logger.error(f"Error processing HTML content: {e}")
        return {
            "cleaned_html": "",
            "text_content": "",
            "script_urls": [],
            "page_links": []
        }

def _extract_script_urls(soup: BeautifulSoup) -> List[str]:
    """Extract URLs from script tags."""
    urls = []
    for script in soup.find_all("script"):
        script_content = script.string or script.get_text()
        if script_content:
            matches = URL_EXTRACTOR.findall(script_content)
            urls.extend(matches)
    return urls

def _remove_unwanted_tags(
    soup: BeautifulSoup, 
    remove_scripts: bool, 
    remove_styles: bool, 
    excluded_tags: List[str]
) -> None:
    """Remove unwanted HTML tags."""
    tags_to_remove = set(excluded_tags)
    
    if remove_scripts:
        tags_to_remove.add("script")
    if remove_styles:
        tags_to_remove.add("style")
    
    for tag_name in tags_to_remove:
        for tag in soup.find_all(tag_name):
            tag.extract()

def _process_images(
    soup: BeautifulSoup,
    keep_images: bool,
    remove_svg: bool,
    remove_gif: bool,
    excluded_image_types: List[str]
) -> None:
    """Process image tags based on configuration."""
    if not keep_images:
        for img in soup.find_all("img"):
            img.extract()
        return
    
    # Build set of extensions to remove
    remove_extensions = set(excluded_image_types)
    if remove_svg:
        remove_extensions.add(".svg")
    if remove_gif:
        remove_extensions.add(".gif")
    
    # Process each image
    for img in soup.find_all("img"):
        src = img.get("src", "").strip()
        if any(src.lower().endswith(ext) for ext in remove_extensions):
            img.extract()
        else:
            # Replace with image URL for text extraction
            img.replace_with(f"\n[IMAGE: {src}]\n")

def _process_links(soup: BeautifulSoup) -> List[Dict[str, str]]:
    """Process anchor tags and extract link information."""
    links = []
    for link in soup.find_all("a"):
        parent_element = link.find_parent()
        
        href = link.get("href")
        if href:
            href = href.strip()
        else:
            continue  # skip if no href
        if href.startswith("//"):
            href = "https:" + href

        text = link.get_text() or ""
        text = text.strip()

        title = link.get("title")
        if title:
            title = title.strip()
        
        # if href and is_valid_url(href):
        link_data = {"url": href}

        if text:
            link_data["text"] = text

        if title:
            link_data["title"] = title

        if parent_element:
            parent_text = parent_element.get_text(strip=True)
            if parent_text:
                link_data["parent_text"] = parent_text

        links.append(link_data)
    return links

def _remove_all_links(soup: BeautifulSoup) -> None:
    """Remove all anchor tags."""
    for link in soup.find_all("a"):
        link.extract()

def _remove_tags_with_attributes(soup: BeautifulSoup, excluded_attributes: List[str]) -> None:
    """
    Remove tags that have ANY of the specified attributes.
    
    Args:
        soup: BeautifulSoup object to modify
        excluded_attributes: List of attribute names - if a tag has ANY of these attributes, it will be removed
        
    Example:
        excluded_attributes = ['style', 'role', 'aria-label', 'data-track']
        # This will remove any tag that has style OR role OR aria-label OR data-track attributes
    """
    tags_to_remove = []
    
    # Find all tags in the soup
    for tag in soup.find_all():
        # Check if tag has any of the excluded attributes
        if any(attr in tag.attrs for attr in excluded_attributes):
            tags_to_remove.append(tag)
    
    # Remove the tags
    for tag in tags_to_remove:
        tag.extract()

def _get_cleaned_html(soup: BeautifulSoup) -> str:
    """Extract and minify HTML content."""
    # Prefer body content if available
    body = soup.find("body")
    html_content = str(body) if body else str(soup)
    
    try:
        return minify(html_content)
    except Exception as e:
        logger.warning(f"HTML minification failed: {e}")
        return html_content

# Convenience function with common defaults
def extract_text_from_html(html_content: str) -> str:
    """
    Simple function to extract plain text from HTML.

    Args:
        html_content: Raw HTML string

    Returns:
        Plain text content
    """
    result = process_html_content(html_content)
    return result["text_content"]


def extract_features_from_html(data: dict) -> dict:
    feature_data = {
        'page_features': process_html_content(
            html_content=data.get('pageContent'),
            excluded_tags=['footer']
        )
    }
    iframes = data.get('iframes', [])
    filtered_iframes = rank_iframes(iframes)
    feature_data['iframes'] = filtered_iframes [0] if filtered_iframes else {}
    content = data.get("pageContent", "")
    soup = BeautifulSoup(content, "html.parser")
    visible_text = soup.get_text(separator=' ', strip=True)
    meta_description = detect_meta_description(soup=soup)
    patterns = detect_suspicious_patterns(content)
    players = detect_suspicious_players(content)
    keywords = detect_keywords(visible_text)
    layout = data.get('layout')
    page_script_urls = feature_data.get('page_features').get('script_urls')
    page_text_content = feature_data.get('page_features').get('text_content')
    page_links = feature_data.get('page_features').get('page_links') or []
    iframe = feature_data.get('iframes').get('iframe') if feature_data.get('iframes') else ''
    processed_iframe_html = process_html_content(feature_data.get('iframes').get('iframe_html'), return_html=True)if feature_data.get('iframes') else ''
    iframe_html = processed_iframe_html.get('cleaned_html') if processed_iframe_html else None
    if processed_iframe_html:
        page_links.extend(processed_iframe_html.get('page_links')) # enrich page_links with links extracted from iframe html
    return {
        "mainUrl": data.get('url'),
        # "page_features": feature_data.get('page_features'),
        "page_links": page_links,
        "page_text_content": page_text_content,
        # "page_script_urls": page_script_urls,
        "page_has_header": layout.get('hasHeader'),
        "page_has_footer": layout.get('hasFooter'),
        "page_has_navbar": layout.get('hasNav'),
        "page_network": data.get('network'),
        "players_found": players,
        "iframe": iframe,
        "iframe_html": iframe_html,
        "suspicious_patterns": patterns,
        "meta_description": meta_description,
        "keywords": keywords,
        "screenshot_url": data.get('screenshotUrl'),
    }


def scrape_with_node(target_url: str) -> Optional[dict]:
    print(f"\n{'='*80}")
    print(f"PROCESSING URL ----->: {target_url}")
    print(f"{'='*80}")
    result = subprocess.run(
        ['node', 'test.js', target_url],
        capture_output=True,
        text=True,
        encoding='utf-8'
    )
    if result.returncode != 0:
        print("Error:", result.stderr)
        return None
    print("Raw stderr:\n", result.stderr)
    raw_html = json.loads(result.stdout)
    if not raw_html:
        print("Failed to scrape the page.")
        return
    page_features = extract_features_from_html(data=raw_html)
    return page_features

if _name_ == "_main_":
    scrape_with_node("_input.first().json.Site"