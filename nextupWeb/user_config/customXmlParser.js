// ===================================================================
// customXmlParser.js
// Behavior Tree XML <-> JSON parser with stable internal _uid support
// ===================================================================

import { DOMParser } from 'xmldom';
import crypto from 'crypto';

// ======================= UID Generator =======================
export function generateUniqueId(prefix = 'uid_') {
  return prefix + crypto.randomBytes(6).toString('hex') + '_' + Date.now().toString(36);
}

// ======================= XML → JSON =======================
export function xmlToJson(xml) {
  let obj = {};

  // --- element node ---
  if (xml.nodeType === 1) {
    if (xml.attributes && xml.attributes.length > 0) {
      obj['@attributes'] = {};
      // Preserve attribute order as parsed
      for (let j = 0; j < xml.attributes.length; j++) {
        const attr = xml.attributes.item(j);
        obj['@attributes'][attr.nodeName] = attr.nodeValue;
      }
    }
  }
  // --- text node ---
  else if (xml.nodeType === 3) {
    return xml.nodeValue.trim();
  }

  // --- children ---
  const children = [];
  if (xml.hasChildNodes()) {
    for (let i = 0; i < xml.childNodes.length; i++) {
      const item = xml.childNodes.item(i);
      if (item.nodeType === 3) {
        const text = item.nodeValue.trim();
        if (text) obj['#text'] = text;
      } else if (item.nodeType === 1) {
        children.push({ tagName: item.nodeName, content: xmlToJson(item) });
      }
    }
  }

  if (children.length > 0) obj['@children'] = children;

  return obj;
}

// ======================= UID Injection =======================
export function ensureUids(node) {
  if (!node) return;

  if (node['@attributes']) {
    // Generate once per node; do not overwrite if already exists
    if (!node['@attributes']._uid) {
      node['@attributes']._uid = generateUniqueId();
    }
  } else {
    node['@attributes'] = { _uid: generateUniqueId() };
  }

  if (node['@children']) {
    node['@children'].forEach(child => ensureUids(child.content));
  }
}

// ======================= Strip UIDs before writing =======================
export function stripInternalUids(node) {
  if (!node) return;

  if (node['@attributes'] && node['@attributes']._uid) {
    delete node['@attributes']._uid;
  }

  if (node['@children']) {
    node['@children'].forEach(child => stripInternalUids(child.content));
  }
}

// ======================= JSON → XML =======================
export function jsonToXml(obj, includeHeader = false) {
  let xml = '';

  if (includeHeader) {
    xml += '<?xml version="1.0" encoding="UTF-8"?>\n';
  }

  // Recursively convert JSON to XML preserving order
  function convert(node, nodeName, indent = '') {
    if (node === null || node === undefined) return `${indent}<${nodeName}/>\n`;
    if (typeof node !== 'object') return `${indent}<${nodeName}>${escapeXml(String(node))}</${nodeName}>\n`;

    let attrs = '';
    let children = '';
    let textContent = '';

    // --- Attributes ---
    if (node['@attributes']) {
      for (const [k, v] of Object.entries(node['@attributes'])) {
        // Skip internal UID attributes
        if (k === '_uid') continue;
        attrs += ` ${k}="${escapeXml(String(v))}"`;
      }
    }

    // --- Text ---
    if (node['#text']) textContent = escapeXml(node['#text']);

    // --- Children ---
    if (node['@children'] && node['@children'].length > 0) {
      node['@children'].forEach(child => {
        children += convert(child.content, child.tagName, indent + '  ');
      });
    }

    // --- Serialize ---
    if (children) {
      return `${indent}<${nodeName}${attrs}>\n${children}${indent}</${nodeName}>\n`;
    } else if (textContent) {
      return `${indent}<${nodeName}${attrs}>${textContent}</${nodeName}>\n`;
    } else {
      return `${indent}<${nodeName}${attrs}/>\n`;
    }
  }

  function escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  for (const key in obj) {
    xml += convert(obj[key], key);
  }

  return xml;
}

// ======================= Parse from string =======================
export function parseXmlString(xmlString) {
  const xmlDoc = new DOMParser().parseFromString(xmlString, 'text/xml');
  const rootJson = xmlToJson(xmlDoc.documentElement);
  ensureUids(rootJson); // add internal uids
  return rootJson;
}

// ======================= XML Pretty Print (optional debug) =======================
export function formatXml(xml) {
  let formatted = '';
  let indent = '';
  const tab = '  ';
  xml.split(/>\s*</).forEach(node => {
    if (node.match(/^\/\w/)) indent = indent.substring(tab.length);
    formatted += indent + '<' + node + '>\n';
    if (node.match(/^<?\w[^>]*[^\/]$/) && !node.startsWith('?')) indent += tab;
  });
  return formatted.substring(1, formatted.length - 2);
}
