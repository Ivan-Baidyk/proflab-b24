(function() {
  'use strict';

  var CFG = window.AI_CONFIG || null;

  function deny(msg) {
    document.body.innerHTML =
      '<div style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f5f7">' +
      '<div style="text-align:center;color:#666;max-width:420px;padding:20px">' +
      '<h2 style="color:#333">Доступ только из Bitrix24</h2>' +
      '<p>' + msg + '</p>' +
      '</div></div>';
  }

  if (!CFG) {
    deny('Этот виджет работает внутри карточки сделки Bitrix24 (вкладка «Формирование КП»).');
    return;
  }

  var SEARCH_URL = CFG.webhook_search || '';
  var KP_LOAD_URL = CFG.webhook_load || '';
  var KP_WEBHOOK_URL = CFG.webhook_create || '';
  var UNITS_URL = CFG.webhook_units || '';

  var state = {
    dealId: null,
    deal: null,
    contact: null,
    items: []
  };

  var unitsRules = [];
  var unitsLoaded = false;

  var searchInput = document.getElementById('search-input');
  var suggestions = document.getElementById('suggestions');
  var itemsBody = document.getElementById('items-body');
  var emptyHint = document.getElementById('empty-hint');
  var totalEl = document.getElementById('total');
  var createBtn = document.getElementById('create-kp');
  var statusEl = document.getElementById('status');
  var dealMeta = document.getElementById('deal-meta');
  var contactMeta = document.getElementById('contact-meta');

  function callMethod(method, params) {
    return new Promise(function(resolve, reject) {
      BX24.callMethod(method, params || {}, function(result) {
        if (result.error()) {
          var ex = result.error().ex || {};
          reject(new Error(ex.error_description || ex.error || 'BX24 error'));
        } else {
          resolve(result.data());
        }
      });
    });
  }

  function firstValue(field) {
    if (Array.isArray(field) && field.length) return field[0].VALUE || '';
    return field || '';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (isError ? ' error' : '');
  }

  function normalizeUnit(u) {
    return String(u || '').trim().toLowerCase().replace(/\.+$/, '');
  }

  function getAlternatives(unit) {
    var nu = normalizeUnit(unit);
    var alts = [];
    var seen = {};
    unitsRules.forEach(function(rule) {
      if (normalizeUnit(rule.единица_в_прайсе) === nu) {
        var alt = rule.единица_в_запросе;
        if (alt && !seen[normalizeUnit(alt)]) {
          seen[normalizeUnit(alt)] = true;
          alts.push(alt);
        }
      }
    });
    return alts;
  }

  function loadUnitsRules() {
    if (!UNITS_URL || unitsLoaded) return;
    unitsLoaded = true;
    fetch(UNITS_URL)
      .then(function(resp) { return resp.text(); })
      .then(function(text) {
        var data = {};
        try { data = JSON.parse(text); } catch (e) { data = []; }
        var rules = [];
        if (Array.isArray(data) && data.length && data[0] && data[0].правила) {
          rules = data[0].правила;
        } else if (data && data.правила) {
          rules = data.правила;
        }
        if (Array.isArray(rules)) {
          unitsRules = rules;
          if (state.items.length) renderItems();
        }
      })
      .catch(function() {});
  }

  function buildUnitCell(item, i) {
    var alts = getAlternatives(item.ед_измерения);
    if (!alts.length) {
      return '<td class="c-unit">' + escapeHtml(item.ед_измерения) + '</td>';
    }
    var options = [item.ед_измерения].concat(alts);
    var seen = {};
    var html = '<td class="c-unit"><select class="unit-select" data-index="' + i + '">';
    options.forEach(function(o) {
      var n = normalizeUnit(o);
      if (seen[n]) return;
      seen[n] = true;
      var sel = (normalizeUnit(o) === normalizeUnit(item.ед_измерения)) ? ' selected' : '';
      html += '<option value="' + escapeHtml(o) + '"' + sel + '>' + escapeHtml(o) + '</option>';
    });
    html += '</select></td>';
    return html;
  }

  function getEntityIdFromPage() {
    var id = (CFG && CFG.entity_id) || '';
    if (id) return String(id);
    try {
      var q = new URLSearchParams(window.location.search);
      id = q.get('PLACEMENT_OPTIONS[ID]') || q.get('ID') || q.get('id') || '';
    } catch (e) { id = ''; }
    return id ? String(id) : '';
  }

  function startDeal(dealId) {
    if (!dealId) {
      dealMeta.textContent = 'Откройте вкладку в карточке сделки';
      BX24.fitWindow();
      return;
    }
    state.dealId = dealId;
    loadExistingKp(dealId);
    callMethod('crm.deal.get', { id: dealId }).then(function(deal) {
      state.deal = deal;
      dealMeta.textContent = 'Сделка: ' + (deal.TITLE || ('#' + dealId));
      if (deal.CONTACT_ID) {
        return callMethod('crm.contact.get', { id: deal.CONTACT_ID }).then(function(contact) {
          state.contact = contact;
          var name = [contact.LAST_NAME, contact.NAME, contact.SECOND_NAME].filter(Boolean).join(' ');
          var phone = firstValue(contact.PHONE);
          var email = firstValue(contact.EMAIL);
          contactMeta.textContent = 'Контакт: ' + (name || ('#' + deal.CONTACT_ID)) +
            (phone ? ' · ' + phone : '') + (email ? ' · ' + email : '');
        });
      }
    }).catch(function() {
    }).then(function() {
      BX24.fitWindow();
    });
  }

  function loadContext() {
    BX24.init(function() {
      var id = getEntityIdFromPage();
      if (id) {
        startDeal(id);
      } else {
        BX24.placement.info().then(function(info) {
          startDeal(info && info.options && info.options.ID);
        }).catch(function() {
          startDeal(null);
        });
      }
    });
  }

  function loadExistingKp(dealId) {
    if (!KP_LOAD_URL) return;
    fetch(KP_LOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: dealId })
    }).then(function(resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.text();
    }).then(function(text) {
      var data = {};
      try { data = JSON.parse(text); } catch (e) { data = { results: [] }; }
      var results = (data.results && Array.isArray(data.results)) ? data.results : [];
      if (results.length) {
        state.items = results.map(function(r) {
          var q = parseInt(r.кол_во, 10);
          return {
            наименование: r.наименование || '',
            ед_измерения: r.ед_измерения || '',
            артикул: r.артикул || '',
            цена_оптовая: r.цена_оптовая,
            валюта: r.валюта || '',
            кол_во: (isNaN(q) || q <= 0) ? 1 : q
          };
        });
        renderItems();
      }
    }).catch(function() {});
  }

  var debounceTimer = null;
  var currentResults = [];

  searchInput.addEventListener('input', function() {
    var q = searchInput.value.trim();
    clearTimeout(debounceTimer);
    if (q.length < 3) {
      hideSuggestions();
      return;
    }
    debounceTimer = setTimeout(function() { runSearch(q); }, 300);
  });

  function runSearch(q) {
    if (!SEARCH_URL) return;
    fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: q })
    }).then(function(resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.text();
    }).then(function(text) {
      var data = {};
      try { data = JSON.parse(text); } catch (e) { data = { results: [] }; }
      currentResults = (data.results && Array.isArray(data.results)) ? data.results : [];
      renderSuggestions();
    }).catch(function() {
      currentResults = [];
      renderSuggestions();
    });
  }

  function renderSuggestions() {
    if (!currentResults.length) {
      suggestions.innerHTML = '<div class="suggestion-empty">Ничего не найдено</div>';
      suggestions.style.display = 'block';
      return;
    }
    var html = '';
    currentResults.forEach(function(r, i) {
      html += '<div class="suggestion" data-index="' + i + '">' +
        '<span class="s-name">' + escapeHtml(r.наименование) + '</span>' +
        (r.артикул ? '<span class="s-art">' + escapeHtml(r.артикул) + '</span>' : '') +
        '</div>';
    });
    suggestions.innerHTML = html;
    suggestions.style.display = 'block';
  }

  function hideSuggestions() {
    suggestions.style.display = 'none';
  }

  suggestions.addEventListener('mousedown', function(e) {
    var el = e.target.closest('.suggestion');
    if (el) {
      var idx = parseInt(el.getAttribute('data-index'), 10);
      if (!isNaN(idx) && currentResults[idx]) addItem(currentResults[idx]);
    }
  });

  function addItem(r) {
    state.items.push({
      наименование: r.наименование || '',
      ед_измерения: r.ед_измерения || '',
      артикул: r.артикул || '',
      цена_оптовая: r.цена_оптовая,
      валюта: r.валюта || '',
      кол_во: 1
    });
    searchInput.value = '';
    hideSuggestions();
    currentResults = [];
    renderItems();
    searchInput.focus();
  }

  function renderItems() {
    itemsBody.innerHTML = '';
    if (!state.items.length) {
      emptyHint.style.display = 'block';
      createBtn.disabled = true;
      updateTotal();
      return;
    }
    emptyHint.style.display = 'none';
    createBtn.disabled = false;

    state.items.forEach(function(item, i) {
      var unitCell = buildUnitCell(item, i);
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="c-name">' + escapeHtml(item.наименование) +
          (item.артикул ? '<div class="c-art">арт. ' + escapeHtml(item.артикул) + '</div>' : '') + '</td>' +
        unitCell +
        '<td class="c-qty"><input type="number" min="0" step="1" value="' + escapeHtml(item.кол_во) + '" data-index="' + i + '"></td>' +
        '<td class="c-del"><button class="btn-del" data-index="' + i + '" title="Удалить">×</button></td>';
      itemsBody.appendChild(tr);
    });

    itemsBody.querySelectorAll('input[type=number]').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var idx = parseInt(inp.getAttribute('data-index'), 10);
        var v = parseFloat(inp.value);
        if (!isNaN(v) && v >= 0) state.items[idx].кол_во = v;
        updateTotal();
      });
    });
    itemsBody.querySelectorAll('.unit-select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var idx = parseInt(sel.getAttribute('data-index'), 10);
        state.items[idx].ед_измерения = sel.value;
      });
    });
    itemsBody.querySelectorAll('.btn-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.getAttribute('data-index'), 10);
        state.items.splice(idx, 1);
        renderItems();
      });
    });
    updateTotal();
  }

  function updateTotal() {
    var totalQty = 0;
    state.items.forEach(function(it) {
      var q = parseFloat(it.кол_во) || 0;
      totalQty += q;
    });
    if (!state.items.length) { totalEl.textContent = ''; return; }
    totalEl.textContent = 'Позиций: ' + state.items.length + ' · Кол-во: ' + totalQty;
  }

  createBtn.addEventListener('click', function() {
    var items = state.items.map(function(it) {
      var q = parseFloat(it.кол_во);
      return {
        наименование: it.наименование,
        ед_измерения: it.ед_измерения,
        артикул: it.артикул,
        цена_оптовая: it.цена_оптовая,
        валюта: it.валюта,
        кол_во: (isNaN(q) || q <= 0) ? 0 : q
      };
    }).filter(function(it) { return it.кол_во > 0; });

    if (!items.length) {
      setStatus('Укажите количество хотя бы для одной позиции.', true);
      return;
    }
    if (!KP_WEBHOOK_URL) {
      setStatus('Не настроен вебхук создания КП.', true);
      return;
    }

    var payload = {
      deal_id: state.dealId,
      items: items
    };

    setStatus('Формируем КП…');
    createBtn.disabled = true;

    fetch(KP_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      setStatus('КП формируется');
    }).catch(function(err) {
      setStatus('Ошибка отправки: ' + err.message, true);
    }).then(function() {
      createBtn.disabled = state.items.length === 0;
      BX24.fitWindow();
    });
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.search-block')) hideSuggestions();
  });

  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (currentResults.length) addItem(currentResults[0]);
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  loadUnitsRules();
  loadContext();
})();
