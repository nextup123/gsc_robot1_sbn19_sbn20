/* -------------------------------------------------
   Custom Node Modal - Enhanced Version
   ------------------------------------------------- */
let availableCategoriesForCustom = [];

async function openCustomNodeModal() {
  if (customNodeModalOpen) return;
  customNodeModalOpen = true;
  
  // Refresh available categories from current nodeDefinitions
  if (nodeDefinitions && availableCategories) {
    availableCategoriesForCustom = [...availableCategories];
  }
  
  const modal = document.getElementById('custom-node-modal');
  modal.style.display = 'flex';
  
  // Reset form
  document.getElementById('custom-node-name').value = '';
  document.getElementById('custom-attributes-list').innerHTML = '';
  document.getElementById('custom-node-category').innerHTML = '';
  document.getElementById('custom-node-type').value = 'Action';
  
  // Reset toggle buttons
  const toggleBtns = document.querySelectorAll('.acn-toggle-btn');
  toggleBtns.forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.kind === 'leaf') btn.classList.add('active');
  });
  
  // Reset hidden input for node kind
  const nodeKindInput = document.querySelector('input[name="node-kind"]');
  if (nodeKindInput) nodeKindInput.value = 'leaf';
  
  // Reset type selection
  const firstTypeRadio = document.querySelector('.acn-type-option input');
  if (firstTypeRadio) {
    firstTypeRadio.checked = true;
    document.getElementById('custom-node-type').value = 'Action';
  }
  
  // Initialize UI components
  initToggleButtons();
  initTypeSelection();
  populateCategoryDropdownForCustom();
  addAttributeRow();
  hidePreview();
}

function closeCustomNodeModal() {
  customNodeModalOpen = false;
  const modal = document.getElementById('custom-node-modal');
  if (modal) modal.style.display = 'none';
}

function initToggleButtons() {
  const toggleBtns = document.querySelectorAll('.acn-toggle-btn');
  toggleBtns.forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const kind = btn.dataset.kind;
      const nodeKindInput = document.querySelector('input[name="node-kind"]');
      if (nodeKindInput) nodeKindInput.value = kind;
    };
  });
}

function initTypeSelection() {
  const typeOptions = document.querySelectorAll('.acn-type-option');
  typeOptions.forEach(opt => {
    const radio = opt.querySelector('input');
    radio.onchange = () => {
      if (radio.checked) {
        document.getElementById('custom-node-type').value = radio.value;
      }
    };
  });
}

/* -------------------------------------------------
   Custom Category Modal
   ------------------------------------------------- */
function openNewCategoryModal() {
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'acn-category-modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20000;
    animation: acnFadeIn 0.2s ease-out;
  `;
  
  // Create modal content
  const modal = document.createElement('div');
  modal.className = 'acn-category-modal';
  modal.style.cssText = `
    background: white;
    border-radius: 16px;
    width: 400px;
    max-width: 90%;
    padding: 0;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    animation: acnSlideUp 0.3s cubic-bezier(0.34, 1.2, 0.64, 1);
  `;
  
  modal.innerHTML = `
    <div style="padding: 24px;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </div>
        <div>
          <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #1a202c;">Create New Category</h3>
          <p style="margin: 4px 0 0; font-size: 13px; color: #718096;">Add a new category for your custom nodes</p>
        </div>
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 13px; font-weight: 500; color: #2d3748; margin-bottom: 6px;">
          Category Key *
        </label>
        <input type="text" id="new-category-key" placeholder="e.g., sensors, vision, navigation" 
               style="width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 14px; background: #fafbfc; transition: all 0.2s;">
        <div style="font-size: 11px; color: #718096; margin-top: 4px;">
          Used as internal identifier (lowercase, no spaces)
        </div>
      </div>
      
      <div style="margin-bottom: 24px;">
        <label style="display: block; font-size: 13px; font-weight: 500; color: #2d3748; margin-bottom: 6px;">
          Display Name *
        </label>
        <input type="text" id="new-category-display" placeholder="e.g., Sensors, Vision, Navigation" 
               style="width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 14px; background: #fafbfc; transition: all 0.2s;">
        <div style="font-size: 11px; color: #718096; margin-top: 4px;">
          Shown in the UI menus
        </div>
      </div>
      
      <div style="display: flex; gap: 12px;">
        <button id="cancel-category-btn" style="flex: 1; padding: 10px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 14px; font-weight: 500; color: #475569; cursor: pointer; transition: all 0.2s;">
          Cancel
        </button>
        <button id="create-category-btn" style="flex: 1; padding: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; border-radius: 10px; font-size: 14px; font-weight: 500; color: white; cursor: pointer; transition: all 0.2s;">
          Create Category
        </button>
      </div>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // Focus on first input
  setTimeout(() => {
    const keyInput = document.getElementById('new-category-key');
    if (keyInput) keyInput.focus();
  }, 100);
  
  // Auto-generate display name from key
  const keyInput = document.getElementById('new-category-key');
  const displayInput = document.getElementById('new-category-display');
  
  if (keyInput) {
    keyInput.addEventListener('input', () => {
      if (displayInput && !displayInput.dataset.manual) {
        const generated = keyInput.value
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        displayInput.value = generated;
      }
    });
  }
  
  if (displayInput) {
    displayInput.addEventListener('input', () => {
      displayInput.dataset.manual = 'true';
    });
  }
  
  // Handle create button
  const createBtn = document.getElementById('create-category-btn');
  if (createBtn) {
    createBtn.onclick = () => {
      const categoryKey = document.getElementById('new-category-key')?.value.trim().toLowerCase();
      const displayName = document.getElementById('new-category-display')?.value.trim();
      
      if (!categoryKey) {
        showToast('Category key is required!', 'warning');
        return;
      }
      
      if (!displayName) {
        showToast('Display name is required!', 'warning');
        return;
      }
      
      // Validate category key (only letters, numbers, underscores)
      const validKey = /^[a-z0-9_]+$/.test(categoryKey);
      if (!validKey) {
        showToast('Category key can only contain lowercase letters, numbers, and underscores', 'error');
        return;
      }
      
      if (availableCategoriesForCustom.includes(categoryKey)) {
        showToast('Category already exists!', 'warning');
        return;
      }
      
      // Add new category to nodeDefinitions
      nodeDefinitions[categoryKey] = {
        display_name: displayName,
        description: `Custom ${displayName} nodes`,
        nodes: {
          Action: {},
          Condition: {},
          Control: {},
          Decorator: {}
        }
      };
      
      availableCategoriesForCustom.push(categoryKey);
      availableCategories = availableCategoriesForCustom;
      
      // Update the main category dropdown in the add node section
      populateCategoryDropdown();
      
      // Refresh category dropdown in custom node modal
      populateCategoryDropdownForCustom();
      
      // Auto-select the new category
      const categorySelect = document.getElementById('custom-node-category');
      if (categorySelect) {
        categorySelect.value = categoryKey;
      }
      
      // Close the modal
      overlay.remove();
      
      showToast(`Category "${displayName}" created and selected!`, 'success');
    };
  }
  
  // Handle cancel button
  const cancelBtn = document.getElementById('cancel-category-btn');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      overlay.remove();
    };
  }
  
  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  };
  
  // Close on escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function populateCategoryDropdownForCustom() {
  const categorySelect = document.getElementById('custom-node-category');
  if (!categorySelect) return;
  
  categorySelect.innerHTML = '';
  
  // Add existing categories
  availableCategoriesForCustom.forEach(catKey => {
    const category = nodeDefinitions[catKey];
    const option = document.createElement('option');
    option.value = catKey;
    option.textContent = `${category.display_name} (${catKey})`;
    categorySelect.appendChild(option);
  });
  
  // Add separator option
  const separator = document.createElement('option');
  separator.disabled = true;
  separator.textContent = '──────────';
  categorySelect.appendChild(separator);
  
  // Add option to create new category
  const newCatOption = document.createElement('option');
  newCatOption.value = '__NEW_CATEGORY__';
  newCatOption.textContent = '+ Create New Category...';
  newCatOption.style.color = '#34c759';
  newCatOption.style.fontWeight = 'bold';
  categorySelect.appendChild(newCatOption);
  
  // Handle new category selection
  categorySelect.onchange = () => {
    if (categorySelect.value === '__NEW_CATEGORY__') {
      openNewCategoryModal();
      // Reset to previous selection after modal opens
      setTimeout(() => {
        if (availableCategoriesForCustom.length > 0) {
          categorySelect.value = availableCategoriesForCustom[0];
        } else {
          categorySelect.value = '';
        }
      }, 100);
    }
  };
}

function addAttributeRow(key = '', value = '') {
  const list = document.getElementById('custom-attributes-list');
  if (!list) return;
  
  const row = document.createElement('div');
  row.className = 'acn-attr-row';
  row.innerHTML = `
    <input type="text" placeholder="attribute name" value="${escapeHtml(key)}">
    <input type="text" placeholder="default value" value="${escapeHtml(value)}">
    <button type="button" class="remove-attr-btn" title="Remove attribute">×</button>
  `;
  const removeBtn = row.querySelector('.remove-attr-btn');
  removeBtn.onclick = () => {
    row.remove();
    updatePreview();
  };
  
  // Add input event listeners for preview
  const inputs = row.querySelectorAll('input');
  inputs.forEach(input => {
    input.addEventListener('input', () => updatePreview());
  });
  
  list.appendChild(row);
  updatePreview();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

function updatePreview() {
  const previewCard = document.getElementById('attribute-preview');
  const previewContent = document.getElementById('preview-content');
  
  if (!previewCard || !previewContent) return;
  
  const attributes = {};
  const rows = document.querySelectorAll('#custom-attributes-list .acn-attr-row');
  
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const k = inputs[0]?.value.trim();
    const v = inputs[1]?.value.trim();
    if (k) attributes[k] = v || "";
  });
  
  if (Object.keys(attributes).length > 0) {
    previewContent.textContent = JSON.stringify(attributes, null, 2);
    // previewCard.style.display = 'block';
  } else {
    previewCard.style.display = 'none';
  }
}

function hidePreview() {
  const previewCard = document.getElementById('attribute-preview');
  if (previewCard) previewCard.style.display = 'none';
}

// Save custom node
function initSaveButton() {
  const saveBtn = document.getElementById('save-custom-node');
  if (!saveBtn) return;
  
  // Remove old event listener if exists
  const newSaveBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  
  newSaveBtn.onclick = async () => {
    const name = document.getElementById('custom-node-name')?.value.trim();
    const categoryKey = document.getElementById('custom-node-category')?.value;
    const nodeType = document.getElementById('custom-node-type')?.value;
    const nodeKindInput = document.querySelector('input[name="node-kind"]');
    const isWrapper = nodeKindInput ? nodeKindInput.value === 'wrapper' : false;
    
    if (!name) {
      showToast('Node name required!', 'warning');
      return;
    }
    
    if (!categoryKey || categoryKey === '__NEW_CATEGORY__') {
      showToast('Please select a valid category!', 'warning');
      return;
    }
    
    // Check if node already exists
    const category = nodeDefinitions[categoryKey];
    if (category && category.nodes[nodeType] && category.nodes[nodeType][name]) {
      showToast(`Node "${name}" already exists in this category!`, 'error');
      return;
    }
    
    // Collect attributes
    const attributes = {};
    const rows = document.querySelectorAll('#custom-attributes-list .acn-attr-row');
    rows.forEach(row => {
      const inputs = row.querySelectorAll('input');
      const k = inputs[0]?.value.trim();
      const v = inputs[1]?.value.trim();
      if (k) attributes[k] = v;
    });
    
    // Show loading state
    const originalText = newSaveBtn.textContent;
    newSaveBtn.textContent = 'Creating...';
    newSaveBtn.disabled = true;
    
    try {
      const res = await fetch(`${API_BASE}/addCustomNode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          category: categoryKey,
          nodeType,
          isWrapper, 
          attributes 
        })
      });
      
      if (!res.ok) {
        const error = await res.text();
        throw new Error(error);
      }
      
      // Update local nodeDefinitions
      if (!nodeDefinitions[categoryKey]) {
        nodeDefinitions[categoryKey] = {
          display_name: categoryKey,
          description: `Custom ${categoryKey} nodes`,
          nodes: { Action: {}, Condition: {}, Control: {}, Decorator: {} }
        };
      }
      
      if (!nodeDefinitions[categoryKey].nodes[nodeType]) {
        nodeDefinitions[categoryKey].nodes[nodeType] = {};
      }
      
      nodeDefinitions[categoryKey].nodes[nodeType][name] = {
        type: isWrapper ? 'wrapper' : 'leaf',
        attributes: attributes,
        ...(isWrapper ? { children: [] } : {})
      };
      
      showToast(`Custom node "${name}" created successfully!`, 'success');
      closeCustomNodeModal();
      
      // Reload node types to update UI
      await loadNodeTypes();
      
    } catch (err) {
      console.error(err);
      showToast(`Failed to create node: ${err.message}`, 'error');
    } finally {
      newSaveBtn.textContent = originalText;
      newSaveBtn.disabled = false;
    }
  };
}

// Add attribute button handler
function initAddAttributeButton() {
  const addAttrBtn = document.getElementById('add-attr-btn');
  if (addAttrBtn) {
    // Remove old event listener
    const newBtn = addAttrBtn.cloneNode(true);
    addAttrBtn.parentNode.replaceChild(newBtn, addAttrBtn);
    newBtn.onclick = () => addAttributeRow();
  }
}

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initSaveButton();
  initAddAttributeButton();
});

// Also export/override the global functions
window.openCustomNodeModal = openCustomNodeModal;
window.closeCustomNodeModal = closeCustomNodeModal;