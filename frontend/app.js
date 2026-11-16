// ================= CONFIG =================
const API = 'http://localhost:5000/api'; // backend URL

// Every fetch carries the httpOnly session cookie — never localStorage
const api = async (path, options = {}) => {
    const res = await fetch(`${API}${path}`, {
        credentials: 'include', // send httpOnly JWT cookie
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
};

// ================= HELPERS =================
const $ = (s) => document.querySelector(s);
const CAT_COLORS = { Food: '#f5a524', Transport: '#3b82f6', Shopping: '#8b5cf6', Bills: '#e5484d', Health: '#12a37a', Entertainment: '#ec4899', Other: '#6a7390' };
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => dkey(new Date());
const curKey = () => todayStr().slice(0, 7);
let month = curKey();
const cv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const catColor = (c) => CAT_COLORS[c] || CAT_COLORS.Other;
const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

let toastTimer;
function toast(msg, isError = false, action) {
    const t = $('#toast');
    t.textContent = msg;
    if (action) {
        const b = document.createElement('button');
        b.className = 'toast-action'; b.textContent = action.label;
        b.onclick = () => { t.classList.add('hidden'); action.fn(); };
        t.appendChild(b);
    }
    t.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), action ? 6000 : 3000);
}

// XSS-safe renderer: textContent, never innerHTML for user data
function row(date, category, note, amount, id, withDelete = false, item = null) {
    const tr = document.createElement('tr');
    [new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), category, note || '—'].forEach((v, i) => {
        const td = document.createElement('td');
        if (i === 1) {
            const chip = document.createElement('span');
            chip.className = 'chip'; chip.style.setProperty('--c', catColor(v));
            chip.textContent = v; td.appendChild(chip);
        } else td.textContent = v; // safe: textContent escapes automatically
        tr.appendChild(td);
    });
    const tdA = document.createElement('td');
    tdA.className = 'amount';
    tdA.textContent = fmt(amount);
    tr.appendChild(tdA);
    if (withDelete) {
        const td = document.createElement('td');
        const btn = document.createElement('button');
        td.className = 'actions';
        const ed = document.createElement('button');
        ed.className = 'del-btn'; ed.textContent = '✏️'; ed.setAttribute('aria-label', 'Edit expense');
        ed.onclick = () => openModal(item);
        btn.className = 'del-btn'; btn.textContent = '🗑️'; btn.setAttribute('aria-label', 'Delete expense');
        btn.onclick = () => deleteExpense(id);
        td.append(ed, btn); tr.appendChild(td);
    }
    return tr;
}

// ================= AUTH =================
$('#showSignup').onclick = (e) => { e.preventDefault(); $('#loginForm').classList.add('hidden'); $('#signupForm').classList.remove('hidden'); };
$('#showLogin').onclick = (e) => { e.preventDefault(); $('#signupForm').classList.add('hidden'); $('#loginForm').classList.remove('hidden'); };

$('#signupForm').onsubmit = async (e) => {
    e.preventDefault();
    const pw = $('#signupPassword').value, cf = $('#signupConfirm').value;
    if (pw !== cf) return toast('Passwords do not match', true);
    try {
        await api('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({
                name: $('#signupName').value.trim(),
                email: $('#signupEmail').value.trim(),
                password: pw,
            }),
        });
        toast('Account created!');
        enterApp();
    } catch (err) { toast(err.message, true); }
};

$('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
        await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: $('#loginEmail').value.trim(),
                password: $('#loginPassword').value,
            }),
        });
        toast('Welcome back!');
        enterApp();
    } catch (err) { toast(err.message, true); }
};

$('#logoutBtn').onclick = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => { });
    location.reload();
};

function enterApp() {
    document.body.classList.add('loading');
    loadProfile();
    $('#authPage').classList.add('hidden');
    $('#fab').classList.remove('hidden');
    $('#app').classList.remove('hidden');
    $('#expDate').value = todayStr();
    refreshAll();
}

// On page load: ask backend if the httpOnly cookie session is valid
(async function checkSession() {
    try { await api('/expenses/stats'); enterApp(); } catch { /* show login */ }
})();

// ================= NAVIGATION =================
document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-btn[data-view]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
        $('#view-' + btn.dataset.view).classList.remove('hidden');
        if (btn.dataset.view === 'profile') loadProfile();
    };
});

// ================= DATA =================
let donutChart, barChart;

async function loadDashboard() {
    try {
        const s = await api('/expenses/stats?month=' + month);
        limits = s.categoryLimits || {};
        $('#limitFields').querySelectorAll('input').forEach((i) => { i.value = limits[i.dataset.cat] || ''; });
        if (document.activeElement !== $('#budgetInput')) $('#budgetInput').value = s.budget;
        $('#kpiToday').textContent = fmt(s.today);
        $('#kpiMonth').textContent = fmt(s.monthTotal);
        $('#kpiLeft').textContent = fmt(s.budgetLeft);
        $('#kpiUsed').textContent = Math.round((s.monthTotal / (s.budget || 1)) * 100) + '%';

        // Hero ring
        const pct = s.budget ? s.monthTotal / s.budget : 0;
        const ring = $('#heroRing');
        ring.style.strokeDashoffset = 515.2 * (1 - Math.min(pct, 1));
        ring.parentNode.classList.toggle('warn', pct >= 0.75 && pct < 1);
        ring.parentNode.classList.toggle('over', pct >= 1);
        $('#heroPct').textContent = Math.round(pct * 100) + '%';
        const now = new Date();
        const [my, mm] = month.split('-').map(Number);
        const dim = new Date(my, mm, 0).getDate();
        const isCur = month === curKey();
        const daysLeft = dim - now.getDate() + 1;
        $('#heroLabel').textContent = isCur ? 'You can spend about' : 'You spent about';
        $('#heroPerDay').textContent = fmt(isCur ? Math.max(s.budgetLeft, 0) / daysLeft : s.monthTotal / dim);
        $('#heroNote').textContent = pct >= 1
            ? 'Over budget. Check your biggest categories in Reports.'
            : isCur ? `${fmt(s.budgetLeft)} left for the next ${daysLeft} day${daysLeft > 1 ? 's' : ''}.`
                : `${fmt(s.budgetLeft)} of your budget was left at month end.`;
        $('#repTitle').textContent = new Date(my, mm - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) + ' by category';
        // month-over-month
        const diff = s.monthTotal - (s.prevMonthTotal || 0), mc = $('#momChip');
        mc.textContent = s.prevMonthTotal ? `${fmt(Math.abs(diff))} ${diff <= 0 ? 'less' : 'more'} than ${isCur ? 'this time last month' : 'the month before'}` : '';
        mc.className = 'pill ' + (diff <= 0 ? 'good' : 'bad');
        // streak of days under the daily allowance
        let streak = 0;
        if (isCur && s.budget) {
            const cap = s.budget / dim, byDay = {};
            allItems.forEach((it) => { const k = it.date.slice(0, 10); byDay[k] = (byDay[k] || 0) + it.amount; });
            for (let d = new Date(); d.getMonth() === mm - 1; d.setDate(d.getDate() - 1)) {
                if ((byDay[dkey(d)] || 0) > cap) break;
                streak++;
            }
        }
        const sc = $('#streakChip');
        sc.textContent = streak > 1 ? `${streak}-day streak under ${fmt(s.budget / dim)}/day` : '';
        sc.classList.toggle('hidden', streak <= 1);
        greet();

        // Donut — category breakdown
        const cats = s.byCategory.map((c) => c._id);
        const vals = s.byCategory.map((c) => c.total);
        const overCat = cats.find((c, i) => limits[c] && vals[i] > limits[c]);
        if (overCat) $('#heroNote').textContent += ` ${overCat} is over its limit.`;
        if (donutChart) donutChart.destroy();
        donutChart = new Chart($('#donutChart'), {
            type: 'doughnut',
            data: {
                labels: cats.length ? cats : ['No data yet'],
                datasets: [{
                    data: vals.length ? vals : [1],
                    backgroundColor: cats.length ? cats.map(catColor) : [cv('--line')], borderWidth: 3, borderColor: cv('--panel')
                }]
            },
            options: { cutout: '68%', plugins: { legend: { position: 'bottom', labels: { color: '#6a7390', usePointStyle: true } } } },
        });

        // Bar — last 7 days from recent expenses
        const items = allItems;
        const endDate = isCur ? new Date() : new Date(my, mm - 1, dim, 12);
        const days = [...Array(7)].map((_, i) => {
            const d = new Date(endDate); d.setDate(d.getDate() - (6 - i));
            return { key: dkey(d), label: d.toLocaleDateString('en-IN', { weekday: 'short' }) };
        });
        const dayTotals = days.map(({ key }) =>
            items.filter((it) => it.date.slice(0, 10) === key)
                .reduce((sum, it) => sum + it.amount, 0));
        if (barChart) barChart.destroy();
        barChart = new Chart($('#barChart'), {
            type: 'bar',
            data: {
                labels: days.map((d) => d.label),
                datasets: [{ label: 'Spent (₹)', data: dayTotals, backgroundColor: cv('--bar'), borderRadius: 8 }]
            },
            options: {
                plugins: { legend: { display: false } },
                scales: {
                    y: { ticks: { color: '#6a7390' }, grid: { color: cv('--line') }, border: { display: false } },
                    x: { ticks: { color: '#6a7390' }, grid: { display: false } }
                }
            },
        });

        // Reports view
        const list = $('#reportList');
        list.textContent = '';
        if (!cats.length) list.textContent = 'No expenses this month yet.';
        cats.forEach((c, i) => {
            const lim = limits[c];
            const pct = Math.round((vals[i] / (lim || s.monthTotal)) * 100);
            const div = document.createElement('div');
            div.className = 'report-row';
            const label = document.createElement('span'); label.className = 'label'; label.textContent = c;
            const bar = document.createElement('div'); bar.className = 'bar';
            const fill = document.createElement('div'); fill.className = 'fill'; fill.style.width = Math.min(pct, 100) + '%'; fill.style.setProperty('--c', lim && pct >= 100 ? '#e5484d' : catColor(c));
            bar.appendChild(fill);
            const val = document.createElement('span'); val.className = 'val'; val.textContent = fmt(vals[i]) + (lim ? ' / ' + fmt(lim) : '');
            div.append(label, bar, val);
            list.appendChild(div);
        });
    } catch (err) { toast(err.message, true); }
}

let allItems = [];
async function loadExpenses() {
    try {
        const { items } = await api('/expenses?limit=100&month=' + month);
        allItems = items; renderExpenses(); fillNotes();
    } catch (err) { toast(err.message, true); }
}

function renderExpenses() {
    const q = $('#fSearch').value.trim().toLowerCase(), cat = $('#fCat').value;
    const tbA = $('#allTable tbody'), tbR = $('#recentTable tbody');
    tbA.textContent = ''; tbR.textContent = '';
    allItems.slice(0, 5).forEach((it) => tbR.appendChild(row(it.date, it.category, it.note, it.amount, it._id)));
    const list = allItems.filter((it) => (!cat || it.category === cat) &&
        (!q || (it.note || '').toLowerCase().includes(q) || it.category.toLowerCase().includes(q)));
    list.forEach((it) => tbA.appendChild(row(it.date, it.category, it.note, it.amount, it._id, true, it)));
    if (!list.length) {
        const tr = document.createElement('tr'), td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = allItems.length ? 'No expenses match your filters.' : 'No expenses yet. Tap + to log your first one.';
        tr.appendChild(td); tbA.appendChild(tr);
    }
}

async function refreshAll() {
    try { await loadExpenses(); await loadDashboard(); }
    finally { document.body.classList.remove('loading'); }
}

$('#addForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
        await api('/expenses', {
            method: 'POST',
            body: JSON.stringify({
                amount: parseFloat($('#expAmount').value),
                category: $('#expCategory').value,
                date: $('#expDate').value,
                note: $('#expNote').value.trim(),
            }),
        });
        $('#addForm').reset();
        $('#expDate').value = todayStr();
        toast('Expense saved');
        refreshAll();
    } catch (err) { toast(err.message, true); }
};

$('#budgetForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
        await api('/expenses/budget', {
            method: 'PUT',
            body: JSON.stringify({ monthlyBudget: parseFloat($('#budgetInput').value) }),
        });
        toast('Budget updated!');
        loadDashboard();
    } catch (err) { toast(err.message, true); }
};

async function deleteExpense(id) {
    const it = allItems.find((x) => x._id === id);
    try {
        await api('/expenses/' + encodeURIComponent(id), { method: 'DELETE' });
        toast('Expense deleted', false, it && {
            label: 'Undo', fn: async () => {
                try {
                    await api('/expenses', { method: 'POST', body: JSON.stringify({ amount: it.amount, category: it.category, date: it.date.slice(0, 10), note: it.note || '' }) });
                    toast('Expense restored'); refreshAll();
                } catch (e) { toast(e.message, true); }
            }
        });
        refreshAll();
    } catch (err) { toast(err.message, true); }
}

// ================= CATEGORIES, LIMITS, FILTERS =================
const CATS = [...$('#expCategory').options].map((o) => o.value);
let limits = {};
CATS.forEach((c) => {
    const o = document.createElement('option'); o.value = o.textContent = c; $('#fCat').appendChild(o);
    const l = document.createElement('label'); l.textContent = c;
    const i = document.createElement('input');
    i.type = 'number'; i.min = 0; i.step = 100; i.dataset.cat = c; i.placeholder = 'No limit';
    l.appendChild(i); $('#limitFields').appendChild(l);
});
$('#limitForm').onsubmit = async (e) => {
    e.preventDefault();
    const next = {};
    $('#limitFields').querySelectorAll('input').forEach((i) => { if (i.value) next[i.dataset.cat] = Number(i.value); });
    try {
        await api('/expenses/limits', { method: 'PUT', body: JSON.stringify({ limits: next }) });
        limits = next; toast('Limits saved'); loadDashboard();
    } catch (err) { toast(err.message, true); }
};
$('#fSearch').oninput = renderExpenses;
$('#fCat').onchange = renderExpenses;

// ================= ADD / EDIT MODAL =================
$('#mCategory').innerHTML = $('#expCategory').innerHTML;
const modal = $('#expModal');
function openModal(item) {
    $('#mTitle').textContent = item ? 'Edit expense' : 'Add expense';
    $('#mId').value = item ? item._id : '';
    $('#mAmount').value = item ? item.amount : '';
    $('#mCategory').value = item ? item.category : CATS[0];
    $('#mDate').value = item ? item.date.slice(0, 10) : todayStr();
    $('#mNote').value = item ? (item.note || '') : '';
    modal.classList.remove('hidden');
    $('#mAmount').focus();
}
const closeModal = () => modal.classList.add('hidden');
$('#fab').onclick = () => openModal(null);
$('#mCancel').onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
$('#expForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = $('#mId').value;
    try {
        await api(id ? '/expenses/' + encodeURIComponent(id) : '/expenses', {
            method: id ? 'PUT' : 'POST',
            body: JSON.stringify({
                amount: parseFloat($('#mAmount').value), category: $('#mCategory').value,
                date: $('#mDate').value, note: $('#mNote').value.trim(),
            }),
        });
        closeModal(); toast(id ? 'Expense updated' : 'Expense saved');
        refreshAll();
    } catch (err) { toast(err.message, true); }
};

// ================= THEME =================
function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    document.querySelectorAll('[data-theme-choice]').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === t));
    try { localStorage.setItem('theme', t); } catch { /* ignore */ }
}
let savedTheme = null;
try { savedTheme = localStorage.getItem('theme'); } catch { /* ignore */ }
applyTheme(savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#themeBtn').onclick = () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    if (!$('#app').classList.contains('hidden')) loadDashboard();
};

// ================= MONTH PICKER =================
$('#monthPicker').value = month;
$('#monthPicker').max = curKey();
$('#monthPicker').onchange = (e) => { month = e.target.value || curKey(); refreshAll(); };

// ================= NOTE SUGGESTIONS + AUTOFILL =================
function fillNotes() {
    const nl = $('#noteList'); nl.textContent = '';
    [...new Set(allItems.map((i) => i.note).filter(Boolean))].slice(0, 30).forEach((n) => {
        const o = document.createElement('option'); o.value = n; nl.appendChild(o);
    });
}
[['#expNote', '#expAmount', '#expCategory'], ['#mNote', '#mAmount', '#mCategory']].forEach(([n, a, c]) => {
    $(n).addEventListener('change', () => {
        const hit = allItems.find((i) => (i.note || '').toLowerCase() === $(n).value.trim().toLowerCase());
        if (hit && !$(a).value) { $(a).value = hit.amount; $(c).value = hit.category; }
    });
});

// ================= EXPORT / IMPORT CSV =================
$('#exportBtn').onclick = () => {
    const q = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const lines = ['Date,Category,Amount,Note', ...allItems.map((i) => [i.date.slice(0, 10), i.category, i.amount, i.note || ''].map(q).join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `expenses-${month}.csv`; a.click(); URL.revokeObjectURL(a.href);
};
const parseLine = (l) => {
    const out = []; let cur = '', inQ = false;
    for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (ch === '"') { if (inQ && l[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
        else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    out.push(cur.trim()); return out;
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const items = [];
    (await f.text()).split(/\r?\n/).filter(Boolean).forEach((line) => {
        const [d, c, a, n] = parseLine(line);
        const amount = parseFloat(a);
        const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : (isNaN(new Date(d)) ? null : dkey(new Date(d)));
        if (!dt || !(amount > 0)) return; // skips the header and bad rows
        items.push({ date: dt, amount, note: n || '', category: CATS.find((x) => x.toLowerCase() === (c || '').toLowerCase()) || 'Other' });
    });
    if (!items.length) return toast('No valid rows. Use columns: date, category, amount, note', true);
    try {
        const r = await api('/expenses/bulk', { method: 'POST', body: JSON.stringify({ items: items.slice(0, 100) }) });
        toast(`Imported ${r.count} expenses` + (items.length > 100 ? ' (first 100 only)' : ''));
        refreshAll();
    } catch (err) { toast(err.message, true); }
};

// ================= INSTALLABLE APP =================
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });

// ================= PROFILE =================
let me = null;
const initials = (n) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
function greet() {
    const now = new Date(), h = now.getHours();
    const hi = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    $('#todayLabel').textContent = (me ? `${hi}, ${me.name.split(' ')[0]}. ` : '') +
        now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}
async function loadProfile() {
    try {
        const d = await api('/auth/me');
        me = d.user;
        ['#chipAvatar', '#pAvatar'].forEach((q) => { $(q).textContent = initials(me.name); });
        $('#chipName').textContent = me.name.split(' ')[0];
        $('#chipEmail').textContent = me.email;
        $('#pName').textContent = me.name;
        $('#pEmail').textContent = me.email;
        const since = new Date(me.memberSince);
        $('#pSince').textContent = 'Member since ' + since.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        if (document.activeElement !== $('#pNameInput')) $('#pNameInput').value = me.name;
        $('#pEmailInput').value = me.email;
        $('#pCount').textContent = d.stats.expenseCount;
        $('#pTotal').textContent = fmt(d.stats.totalSpent);
        $('#pDays').textContent = Math.max(1, Math.ceil((Date.now() - since) / 864e5));
        greet();
    } catch { /* not signed in yet */ }
}
$('#userChip').onclick = () => document.querySelector('.nav-btn[data-view="profile"]').click();
$('#profileForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
        await api('/auth/profile', { method: 'PUT', body: JSON.stringify({ name: $('#pNameInput').value.trim() }) });
        toast('Profile updated'); loadProfile();
    } catch (err) { toast(err.message, true); }
};
$('#passwordForm').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#pwNew').value !== $('#pwConfirm').value) return toast('New passwords do not match', true);
    try {
        await api('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword: $('#pwCurrent').value, newPassword: $('#pwNew').value }) });
        $('#passwordForm').reset(); toast('Password updated');
    } catch (err) { toast(err.message, true); }
};
$('#deleteForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm('Delete your account and all expenses permanently?')) return;
    try {
        await api('/auth/account', { method: 'DELETE', body: JSON.stringify({ password: $('#delPassword').value }) });
        location.reload();
    } catch (err) { toast(err.message, true); }
};
document.querySelectorAll('[data-theme-choice]').forEach((b) => {
    b.onclick = () => { applyTheme(b.dataset.themeChoice); if (!$('#app').classList.contains('hidden')) loadDashboard(); };
});
$('#logoutBtn2').onclick = () => $('#logoutBtn').click();