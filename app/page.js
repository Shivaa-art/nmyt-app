'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabaseClient';

const WINGS = ['Tech Solutions', 'Content Production', 'Backend & Operations'];
const CATEGORIES_EXPENSE = ['Software', 'Contractor', 'Equipment', 'Salary', 'Marketing', 'Travel', 'Rent', 'Misc'];
const CATEGORIES_INCOME = ['Client Payment', 'Retainer', 'Other Income'];
const STAGES = ['Lead', 'Proposal Sent', 'Negotiation', 'Active', 'Paid', 'Lost'];
const TEAM_TYPES = ['Core Team', 'Freelancer', 'Partner'];
const PAYOUT_BASIS = ['Per Project', 'Hourly', 'Monthly', 'Retainer'];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function fmtMoney(n) {
  n = Number(n) || 0;
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function calcTotals(inv) {
  const items = inv.items || [];
  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const tax = subtotal * (Number(inv.tax_rate) || 0) / 100;
  return { subtotal, tax, total: subtotal + tax };
}
function newInvoiceDraft(nextNumber, defaultTaxRate) {
  return {
    id: null,
    number: 'INV-' + String(nextNumber).padStart(4, '0'),
    date: todayStr(),
    due_date: '',
    wing: WINGS[0],
    client_name: '',
    client_address: '',
    client_contact: '',
    items: [{ desc: '', qty: 1, rate: 0 }],
    tax_rate: defaultTaxRate,
    status: 'Draft',
    notes: '',
  };
}
function csvEscape(v) {
  v = String(v == null ? '' : v);
  if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function toCSV(rows, headers) {
  const lines = [headers.join(',')];
  rows.forEach((r) => lines.push(headers.map((h) => csvEscape(r[h])).join(',')));
  return lines.join('\r\n');
}
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function downloadElementPDF(el, filename) {
  if (!el) return;
  const html2pdfMod = await import('html2pdf.js');
  const html2pdf = html2pdfMod.default;
  await html2pdf()
    .set({ margin: 8, filename, html2canvas: { scale: 2, backgroundColor: '#fdfcf9' }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } })
    .from(el)
    .save();
}

export default function Page() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState({ company_name: 'Nmyt', address: '', gstin: '', bank_details: '', tax_rate: 18, next_invoice_number: 1 });
  const [invoices, setInvoices] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [crm, setCrm] = useState([]);
  const [team, setTeam] = useState([]);

  const [tab, setTab] = useState('dashboard');
  const [invoiceDraft, setInvoiceDraft] = useState(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [viewingInvoiceId, setViewingInvoiceId] = useState(null);
  const [invoiceFilter, setInvoiceFilter] = useState({ search: '', status: 'All', wing: 'All' });
  const [ledgerFilter, setLedgerFilter] = useState({ search: '', wing: 'All', type: 'All', category: 'All' });
  const [reportPeriod, setReportPeriod] = useState({ preset: 'all', from: '', to: '' });
  const [toast, setToast] = useState(null);

  const plRef = useRef(null);
  const bsRef = useRef(null);
  const invRef = useRef(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  // ---------- Auth ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setAuthBusy(false);
    if (error) setAuthError(error.message);
  }
  async function handleLogout() {
    await supabase.auth.signOut();
  }

  // ---------- Data loading ----------
  const loadAll = useCallback(async () => {
    const [s, inv, led, c, t] = await Promise.all([
      supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('invoices').select('*').order('date', { ascending: false }),
      supabase.from('ledger').select('*').order('date', { ascending: false }),
      supabase.from('crm').select('*'),
      supabase.from('team').select('*'),
    ]);
    if (s.data) setSettings(s.data);
    if (inv.data) setInvoices(inv.data);
    if (led.data) setLedger(led.data);
    if (c.data) setCrm(c.data);
    if (t.data) setTeam(t.data);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (session) loadAll();
  }, [session, loadAll]);

  // ---------- Settings ----------
  async function saveSettings(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    const { error } = await supabase.from('settings').update(next).eq('id', 1);
    if (error) showToast('Could not save settings');
    else showToast('Settings saved');
  }

  // ---------- Invoices ----------
  function goNewInvoice() {
    setInvoiceDraft(newInvoiceDraft(settings.next_invoice_number || 1, settings.tax_rate || 0));
    setEditingInvoiceId(null);
    setTab('new-invoice');
  }
  function startEditInvoice(inv) {
    setInvoiceDraft(JSON.parse(JSON.stringify(inv)));
    setEditingInvoiceId(inv.id);
    setTab('new-invoice');
  }
  function startDuplicateInvoice(inv) {
    const copy = JSON.parse(JSON.stringify(inv));
    copy.id = null;
    copy.number = 'INV-' + String(settings.next_invoice_number || 1).padStart(4, '0');
    copy.date = todayStr();
    copy.due_date = '';
    copy.status = 'Draft';
    setInvoiceDraft(copy);
    setEditingInvoiceId(null);
    setTab('new-invoice');
    showToast('Duplicated — review and save as a new invoice');
  }
  function cancelInvoiceEdit() {
    const wasEditing = editingInvoiceId;
    setInvoiceDraft(null);
    setEditingInvoiceId(null);
    if (wasEditing) {
      setViewingInvoiceId(wasEditing);
      setTab('invoice-view');
    } else {
      setTab('invoices');
    }
  }
  async function saveInvoice() {
    if (!invoiceDraft.client_name || !invoiceDraft.client_name.trim()) {
      showToast('Add a client name before saving');
      return;
    }
    if (editingInvoiceId) {
      const { id, ...rest } = invoiceDraft;
      const { error } = await supabase.from('invoices').update(rest).eq('id', editingInvoiceId);
      if (error) { showToast('Could not update invoice'); return; }
      showToast('Invoice updated');
      setViewingInvoiceId(editingInvoiceId);
    } else {
      const { id, ...rest } = invoiceDraft;
      const { data, error } = await supabase.from('invoices').insert(rest).select().single();
      if (error) { showToast('Could not save invoice'); return; }
      await saveSettings({ next_invoice_number: (Number(settings.next_invoice_number) || 1) + 1 });
      showToast('Invoice saved');
      setViewingInvoiceId(data.id);
    }
    setInvoiceDraft(null);
    setEditingInvoiceId(null);
    setTab('invoice-view');
    loadAll();
  }
  async function deleteInvoice(id) {
    const { error } = await supabase.from('invoices').delete().eq('id', id);
    if (error) { showToast('Could not delete invoice'); return; }
    showToast('Invoice deleted');
    loadAll();
  }
  async function markInvoice(inv, status) {
    const { error } = await supabase.from('invoices').update({ status }).eq('id', inv.id);
    if (error) { showToast('Could not update status'); return; }
    if (status === 'Paid') {
      const totals = calcTotals(inv);
      await supabase.from('ledger').insert({
        date: todayStr(),
        description: `${inv.number} — ${inv.client_name}`,
        wing: inv.wing,
        category: 'Client Payment',
        type: 'Income',
        amount: totals.total,
      });
      showToast('Marked paid — logged to ledger');
    }
    loadAll();
  }

  // ---------- Ledger ----------
  function ledgerWithBalance(rows) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
    let bal = 0;
    return sorted.map((row) => {
      const signed = row.type === 'Income' ? Number(row.amount) || 0 : -(Number(row.amount) || 0);
      bal += signed;
      return { ...row, signed, balance: bal };
    });
  }
  async function addLedgerEntry(entry) {
    const { error } = await supabase.from('ledger').insert(entry);
    if (error) { showToast('Could not add entry'); return; }
    showToast('Entry added');
    loadAll();
  }
  async function deleteLedgerEntry(id) {
    const { error } = await supabase.from('ledger').delete().eq('id', id);
    if (error) { showToast('Could not delete entry'); return; }
    loadAll();
  }

  function totalsSummary() {
    let income = 0, expense = 0;
    const byWing = {}; WINGS.forEach((w) => (byWing[w] = { income: 0, expense: 0 }));
    ledger.forEach((r) => {
      const amt = Number(r.amount) || 0;
      if (r.type === 'Income') { income += amt; if (byWing[r.wing]) byWing[r.wing].income += amt; }
      else { expense += amt; if (byWing[r.wing]) byWing[r.wing].expense += amt; }
    });
    return { income, expense, net: income - expense, byWing };
  }

  // ---------- CRM ----------
  function weightedValue(e) { return (Number(e.deal_value) || 0) * (Number(e.probability) || 0) / 100; }
  function crmSummary() {
    const pipeline = crm.filter((e) => e.stage !== 'Lost').reduce((s, e) => s + (Number(e.deal_value) || 0), 0);
    const weighted = crm.reduce((s, e) => s + weightedValue(e), 0);
    const won = crm.filter((e) => e.stage === 'Paid').reduce((s, e) => s + (Number(e.deal_value) || 0), 0);
    return { pipeline, weighted, won };
  }
  async function addCrmEntry(entry) {
    const { error } = await supabase.from('crm').insert(entry);
    if (error) { showToast('Could not add opportunity'); return; }
    showToast('Added to pipeline');
    loadAll();
  }
  async function updateCrmStage(id, stage) {
    const { error } = await supabase.from('crm').update({ stage }).eq('id', id);
    if (error) { showToast('Could not update stage'); return; }
    loadAll();
  }
  async function deleteCrmEntry(id) {
    await supabase.from('crm').delete().eq('id', id);
    loadAll();
  }

  // ---------- Team ----------
  async function addTeamMember(member) {
    const { error } = await supabase.from('team').insert(member);
    if (error) { showToast('Could not add team member'); return; }
    showToast('Added to team');
    loadAll();
  }
  async function toggleTeamActive(m) {
    await supabase.from('team').update({ active: !m.active }).eq('id', m.id);
    loadAll();
  }
  async function deleteTeamMember(id) {
    await supabase.from('team').delete().eq('id', id);
    loadAll();
  }
  async function payTeamMember(m) {
    if (!m.payout_rate) { showToast('Set a payout rate first'); return; }
    const category = m.type === 'Core Team' ? 'Salary' : 'Contractor';
    const wing = m.wing === 'Both' ? 'Backend & Operations' : m.wing;
    await supabase.from('ledger').insert({
      date: todayStr(),
      description: `Payment to ${m.name} (${m.role || m.type})`,
      wing, category, type: 'Expense', amount: m.payout_rate,
    });
    showToast(`Logged payment to ${m.name}`);
    loadAll();
  }

  // ---------- Reports ----------
  function computeReceivables() {
    return invoices.filter((i) => i.status === 'Sent').reduce((s, i) => s + calcTotals(i).total, 0);
  }
  function periodBounds(period) {
    const now = new Date();
    if (period.preset === 'this-month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    }
    if (period.preset === 'last-month') {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    }
    if (period.preset === 'this-year') return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
    if (period.preset === 'custom') return { from: period.from || '0000-01-01', to: period.to || '9999-12-31' };
    return { from: '0000-01-01', to: '9999-12-31' };
  }
  function computePL(period) {
    const { from, to } = periodBounds(period);
    const entries = ledger.filter((r) => r.date >= from && r.date <= to);
    const revenueByCategory = {}, expenseByCategory = {};
    let revenue = 0, expense = 0;
    entries.forEach((r) => {
      const amt = Number(r.amount) || 0;
      if (r.type === 'Income') { revenue += amt; revenueByCategory[r.category] = (revenueByCategory[r.category] || 0) + amt; }
      else { expense += amt; expenseByCategory[r.category] = (expenseByCategory[r.category] || 0) + amt; }
    });
    return { from, to, revenue, expense, net: revenue - expense, revenueByCategory, expenseByCategory };
  }

  // ---------- Exports ----------
  function exportInvoicesCSV() {
    const rows = invoices.map((inv) => {
      const t = calcTotals(inv);
      return { Number: inv.number, Date: inv.date, DueDate: inv.due_date, Wing: inv.wing, Client: inv.client_name, Status: inv.status, Subtotal: t.subtotal.toFixed(2), Tax: t.tax.toFixed(2), Total: t.total.toFixed(2) };
    });
    downloadBlob(toCSV(rows, ['Number', 'Date', 'DueDate', 'Wing', 'Client', 'Status', 'Subtotal', 'Tax', 'Total']), 'nmyt_invoices.csv', 'text/csv');
  }
  function exportLedgerCSV() {
    const rows = ledgerWithBalance(ledger).map((r) => ({ Date: r.date, Description: r.description, Wing: r.wing, Category: r.category, Type: r.type, Amount: (Number(r.amount) || 0).toFixed(2), Balance: r.balance.toFixed(2) }));
    downloadBlob(toCSV(rows, ['Date', 'Description', 'Wing', 'Category', 'Type', 'Amount', 'Balance']), 'nmyt_ledger.csv', 'text/csv');
  }
  function exportBackupJSON() {
    downloadBlob(JSON.stringify({ settings, invoices, ledger, crm, team, exportedAt: new Date().toISOString() }, null, 2), 'nmyt_backup.json', 'application/json');
  }

  // ---------- Render gates ----------
  if (!supabaseConfigured) {
    return (
      <div className="nmyt-login-wrap">
        <div className="nmyt-login-card">
          <div className="mark">⚡</div>
          <h1>Setup needed</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10 }}>
            This app can&apos;t reach Supabase yet. In your Vercel project, go to
            <strong> Settings → Environment Variables</strong> and make sure both
            <code style={{ display: 'block', marginTop: 8, color: 'var(--gold-soft)' }}>NEXT_PUBLIC_SUPABASE_URL</code>
            <code style={{ display: 'block', color: 'var(--gold-soft)' }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
            are set for the <strong>Production</strong> environment, then redeploy.
          </p>
        </div>
      </div>
    );
  }
  if (session === undefined) {
    return <div className="nmyt-shell"><p style={{ color: 'var(--muted)' }}>Loading…</p></div>;
  }
  if (!session) {
    return (
      <div className="nmyt-login-wrap">
        <div className="nmyt-login-card">
          <div className="mark">⚡</div>
          <h1>Nmyt</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>Sign in with the account your admin created for you.</p>
          <form onSubmit={handleLogin}>
            <div className="nmyt-field">
              <label>Email</label>
              <input className="nmyt-input" type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
            </div>
            <div className="nmyt-field">
              <label>Password</label>
              <input className="nmyt-input" type="password" required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
            </div>
            <button className="nmyt-btn" style={{ width: '100%' }} disabled={authBusy} type="submit">{authBusy ? 'Signing in…' : 'Sign In'}</button>
            {authError && <div className="nmyt-error">{authError}</div>}
          </form>
        </div>
      </div>
    );
  }
  if (!loaded) {
    return <div className="nmyt-shell"><p style={{ color: 'var(--muted)' }}>Loading your data…</p></div>;
  }

  const tabs = [
    ['dashboard', 'Dashboard'], ['new-invoice', 'New Invoice'], ['invoices', 'Invoices'],
    ['crm', 'Client Pipeline'], ['team', 'Team & Salaries'], ['ledger', 'Ledger'], ['reports', 'Reports'], ['settings', 'Settings'],
  ];

  return (
    <div className="nmyt-shell">
      <div className="nmyt-topbar">
        <div className="nmyt-brand"><span className="mark">⚡</span><h1>{settings.company_name || 'Nmyt'}</h1></div>
        <div className="nmyt-topbar-right">
          <span className="nmyt-user">{session.user.email}</span>
          <button className="nmyt-btn secondary small" onClick={handleLogout}>Sign Out</button>
        </div>
      </div>
      <div className="nmyt-tabs no-print" style={{ marginBottom: 24 }}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={`nmyt-tab ${tab === id ? 'active' : ''}`}
            onClick={() => {
              if (id === 'new-invoice' && !invoiceDraft) { goNewInvoice(); return; }
              setTab(id);
            }}
          >{label}</button>
        ))}
      </div>

      {tab === 'dashboard' && <Dashboard settings={settings} invoices={invoices} totalsSummary={totalsSummary} setViewingInvoiceId={setViewingInvoiceId} setTab={setTab} goNewInvoice={goNewInvoice} />}

      {tab === 'new-invoice' && invoiceDraft && (
        <InvoiceForm
          draft={invoiceDraft}
          setDraft={setInvoiceDraft}
          isEditing={!!editingInvoiceId}
          onSave={saveInvoice}
          onCancel={cancelInvoiceEdit}
        />
      )}

      {tab === 'invoices' && (
        <InvoicesList
          invoices={invoices}
          filter={invoiceFilter}
          setFilter={setInvoiceFilter}
          onView={(id) => { setViewingInvoiceId(id); setTab('invoice-view'); }}
          onEdit={startEditInvoice}
          onDelete={deleteInvoice}
          onNew={goNewInvoice}
          onExportCSV={exportInvoicesCSV}
        />
      )}

      {tab === 'invoice-view' && (
        <InvoiceView
          inv={invoices.find((i) => i.id === viewingInvoiceId)}
          settings={settings}
          invRef={invRef}
          onBack={() => setTab('invoices')}
          onEdit={startEditInvoice}
          onDuplicate={startDuplicateInvoice}
          onMark={markInvoice}
          onDownloadPDF={() => downloadElementPDF(invRef.current, `${viewingInvoiceId}.pdf`)}
        />
      )}

      {tab === 'crm' && (
        <CrmView crm={crm} summary={crmSummary()} weightedValue={weightedValue} onAdd={addCrmEntry} onStage={updateCrmStage} onDelete={deleteCrmEntry} />
      )}

      {tab === 'team' && (
        <TeamView team={team} ledger={ledger} onAdd={addTeamMember} onToggle={toggleTeamActive} onDelete={deleteTeamMember} onPay={payTeamMember} />
      )}

      {tab === 'ledger' && (
        <LedgerView ledger={ledgerWithBalance(ledger)} filter={ledgerFilter} setFilter={setLedgerFilter} onAdd={addLedgerEntry} onDelete={deleteLedgerEntry} onExportCSV={exportLedgerCSV} />
      )}

      {tab === 'reports' && (
        <ReportsView
          period={reportPeriod}
          setPeriod={setReportPeriod}
          pl={computePL(reportPeriod)}
          totals={totalsSummary()}
          receivables={computeReceivables()}
          settings={settings}
          plRef={plRef}
          bsRef={bsRef}
          onDownloadPL={() => downloadElementPDF(plRef.current, 'nmyt_profit_and_loss.pdf')}
          onDownloadBS={() => downloadElementPDF(bsRef.current, 'nmyt_balance_sheet.pdf')}
        />
      )}

      {tab === 'settings' && <SettingsView settings={settings} onSave={saveSettings} onExportBackup={exportBackupJSON} />}

      {toast && <div className="nmyt-toast">{toast}</div>}
    </div>
  );
}

// ================================================================
// Dashboard
// ================================================================
function Dashboard({ settings, invoices, totalsSummary, setViewingInvoiceId, setTab, goNewInvoice }) {
  const t = totalsSummary();
  const recent = [...invoices].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  return (
    <>
      <div className="nmyt-grid">
        <div className="nmyt-card"><div className="nmyt-card-title">Total Income</div><div className="nmyt-stat-value pos">{fmtMoney(t.income)}</div></div>
        <div className="nmyt-card"><div className="nmyt-card-title">Total Expenses</div><div className="nmyt-stat-value neg">{fmtMoney(t.expense)}</div></div>
        <div className="nmyt-card"><div className="nmyt-card-title">Net Balance</div><div className="nmyt-stat-value gold">{fmtMoney(t.net)}</div></div>
        <div className="nmyt-card"><div className="nmyt-card-title">Invoices Issued</div><div className="nmyt-stat-value">{invoices.length}</div></div>
      </div>
      <div className="nmyt-section-head"><h2>By Wing</h2></div>
      <div className="nmyt-card">
        <table className="nmyt-table">
          <thead><tr><th>Wing</th><th className="nmyt-num">Income</th><th className="nmyt-num">Expenses</th><th className="nmyt-num">Net</th></tr></thead>
          <tbody>
            {WINGS.map((w) => (
              <tr key={w}><td>{w}</td><td className="nmyt-num">{fmtMoney(t.byWing[w].income)}</td><td className="nmyt-num">{fmtMoney(t.byWing[w].expense)}</td><td className="nmyt-num">{fmtMoney(t.byWing[w].income - t.byWing[w].expense)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="nmyt-section-head"><h2>Recent Invoices</h2><button className="nmyt-btn small" onClick={goNewInvoice}>+ New Invoice</button></div>
      <div className="nmyt-card">
        {recent.length === 0 ? <Empty title="No invoices yet" sub="Create your first invoice to see it here." /> : (
          <table className="nmyt-table">
            <thead><tr><th>Number</th><th>Client</th><th>Date</th><th>Status</th><th className="nmyt-num">Total</th><th></th></tr></thead>
            <tbody>
              {recent.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.number}</td><td>{inv.client_name || '—'}</td><td>{inv.date}</td>
                  <td><span className={`pill ${inv.status.toLowerCase()}`}>{inv.status}</span></td>
                  <td className="nmyt-num">{fmtMoney(calcTotals(inv).total)}</td>
                  <td><button className="nmyt-btn secondary small" onClick={() => { setViewingInvoiceId(inv.id); setTab('invoice-view'); }}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Empty({ title, sub }) {
  return <div className="nmyt-empty"><h3>{title}</h3><div>{sub}</div></div>;
}

// ================================================================
// Invoice Form (create/edit)
// ================================================================
function InvoiceForm({ draft, setDraft, isEditing, onSave, onCancel }) {
  const totals = calcTotals(draft);
  function updateField(path, value) {
    setDraft((prev) => ({ ...prev, [path]: value }));
  }
  function updateItem(idx, field, value) {
    setDraft((prev) => {
      const items = [...prev.items];
      items[idx] = { ...items[idx], [field]: field === 'desc' ? value : Number(value) };
      return { ...prev, items };
    });
  }
  function addItem() {
    setDraft((prev) => ({ ...prev, items: [...prev.items, { desc: '', qty: 1, rate: 0 }] }));
  }
  function removeItem(idx) {
    setDraft((prev) => {
      const items = prev.items.filter((_, i) => i !== idx);
      return { ...prev, items: items.length ? items : [{ desc: '', qty: 1, rate: 0 }] };
    });
  }

  return (
    <>
      <div className="nmyt-section-head"><h2>{isEditing ? 'Edit Invoice' : 'New Invoice'}</h2></div>
      <div className="nmyt-card">
        <div className="nmyt-row4">
          <div className="nmyt-field"><label>Invoice No.</label><input className="nmyt-input" value={draft.number} onChange={(e) => updateField('number', e.target.value)} /></div>
          <div className="nmyt-field"><label>Date</label><input type="date" className="nmyt-input" value={draft.date} onChange={(e) => updateField('date', e.target.value)} /></div>
          <div className="nmyt-field"><label>Due Date</label><input type="date" className="nmyt-input" value={draft.due_date || ''} onChange={(e) => updateField('due_date', e.target.value)} /></div>
          <div className="nmyt-field"><label>Wing</label>
            <select className="nmyt-select" value={draft.wing} onChange={(e) => updateField('wing', e.target.value)}>
              {WINGS.filter((w) => w !== 'Backend & Operations').map((w) => <option key={w}>{w}</option>)}
            </select>
          </div>
        </div>
        <div className="nmyt-row3">
          <div className="nmyt-field"><label>Client Name</label><input className="nmyt-input" value={draft.client_name} onChange={(e) => updateField('client_name', e.target.value)} placeholder="Client / company name" /></div>
          <div className="nmyt-field"><label>Client Address</label><input className="nmyt-input" value={draft.client_address || ''} onChange={(e) => updateField('client_address', e.target.value)} /></div>
          <div className="nmyt-field"><label>Client Contact</label><input className="nmyt-input" value={draft.client_contact || ''} onChange={(e) => updateField('client_contact', e.target.value)} placeholder="Email / phone" /></div>
        </div>
      </div>

      <div className="nmyt-card">
        <div className="nmyt-card-title">Line Items</div>
        <div className="line-item-row" style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <div>Description</div><div>Qty</div><div></div><div>Rate (₹)</div><div>Amount</div><div></div>
        </div>
        {draft.items.map((it, idx) => (
          <div className="line-item-row" key={idx}>
            <input className="nmyt-input" value={it.desc} onChange={(e) => updateItem(idx, 'desc', e.target.value)} placeholder="Service description" />
            <input type="number" min="0" className="nmyt-input" value={it.qty} onChange={(e) => updateItem(idx, 'qty', e.target.value)} />
            <div></div>
            <input type="number" min="0" className="nmyt-input" value={it.rate} onChange={(e) => updateItem(idx, 'rate', e.target.value)} />
            <div className="nmyt-num" style={{ padding: '9px 0' }}>{fmtMoney((Number(it.qty) || 0) * (Number(it.rate) || 0))}</div>
            <button className="icon-btn" onClick={() => removeItem(idx)} title="Remove line">✕</button>
          </div>
        ))}
        <button className="nmyt-btn secondary small" onClick={addItem} style={{ marginTop: 8 }}>+ Add line</button>

        <div className="nmyt-row2" style={{ marginTop: 24, alignItems: 'end' }}>
          <div className="nmyt-field"><label>Notes</label><textarea className="nmyt-textarea" rows={3} value={draft.notes || ''} onChange={(e) => updateField('notes', e.target.value)} placeholder="Payment terms, bank details, etc." /></div>
          <div>
            <div className="nmyt-field"><label>Tax / GST %</label><input type="number" min="0" className="nmyt-input" value={draft.tax_rate} onChange={(e) => updateField('tax_rate', Number(e.target.value))} /></div>
            <div style={{ textAlign: 'right', fontSize: 13, lineHeight: 2 }}>
              <div>Subtotal: <strong>{fmtMoney(totals.subtotal)}</strong></div>
              <div>Tax: <strong>{fmtMoney(totals.tax)}</strong></div>
              <div style={{ fontSize: 18, color: 'var(--gold-soft)' }}>Total: <strong>{fmtMoney(totals.total)}</strong></div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button className="nmyt-btn" onClick={onSave}>{isEditing ? 'Save Changes' : 'Save Invoice'}</button>
          <button className="nmyt-btn secondary" onClick={onCancel}>{isEditing ? 'Cancel' : 'Clear'}</button>
        </div>
      </div>
    </>
  );
}

// ================================================================
// Invoices List
// ================================================================
function InvoicesList({ invoices, filter, setFilter, onView, onEdit, onDelete, onNew, onExportCSV }) {
  let list = [...invoices].sort((a, b) => b.date.localeCompare(a.date));
  if (filter.status !== 'All') list = list.filter((i) => i.status === filter.status);
  if (filter.wing !== 'All') list = list.filter((i) => i.wing === filter.wing);
  if (filter.search.trim()) {
    const q = filter.search.trim().toLowerCase();
    list = list.filter((i) => (i.number + ' ' + i.client_name).toLowerCase().includes(q));
  }
  return (
    <>
      <div className="nmyt-section-head"><h2>Invoices</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="nmyt-btn secondary small" onClick={onExportCSV}>Download CSV</button>
          <button className="nmyt-btn small" onClick={onNew}>+ New Invoice</button>
        </div>
      </div>
      <div className="nmyt-card">
        <div className="nmyt-row3">
          <div className="nmyt-field"><label>Search</label><input className="nmyt-input" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} placeholder="Client name or invoice #" /></div>
          <div className="nmyt-field"><label>Status</label>
            <select className="nmyt-select" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              {['All', 'Draft', 'Sent', 'Paid'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="nmyt-field"><label>Wing</label>
            <select className="nmyt-select" value={filter.wing} onChange={(e) => setFilter({ ...filter, wing: e.target.value })}>
              {['All', ...WINGS.filter((w) => w !== 'Backend & Operations')].map((w) => <option key={w}>{w}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="nmyt-card">
        {list.length === 0 ? <Empty title="No invoices match" sub="Try clearing your search or filters." /> : (
          <table className="nmyt-table">
            <thead><tr><th>Number</th><th>Client</th><th>Wing</th><th>Date</th><th>Status</th><th className="nmyt-num">Total</th><th></th></tr></thead>
            <tbody>
              {list.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.number}</td><td>{inv.client_name || '—'}</td><td>{inv.wing}</td><td>{inv.date}</td>
                  <td><span className={`pill ${inv.status.toLowerCase()}`}>{inv.status}</span></td>
                  <td className="nmyt-num">{fmtMoney(calcTotals(inv).total)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="nmyt-btn secondary small" onClick={() => onView(inv.id)}>View</button>{' '}
                    <button className="nmyt-btn secondary small" onClick={() => onEdit(inv)}>Edit</button>{' '}
                    <button className="icon-btn" onClick={() => onDelete(inv.id)} title="Delete">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ================================================================
// Invoice View (print/PDF)
// ================================================================
function InvoiceView({ inv, settings, invRef, onBack, onEdit, onDuplicate, onMark, onDownloadPDF }) {
  if (!inv) return <Empty title="Invoice not found" sub="Go back to Invoices." />;
  const totals = calcTotals(inv);
  return (
    <>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <button className="nmyt-btn secondary small" onClick={onBack}>← Back</button>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {inv.status !== 'Paid' && <button className="nmyt-btn secondary small" onClick={() => onMark(inv, 'Paid')}>Mark as Paid</button>}
          {inv.status === 'Draft' && <button className="nmyt-btn secondary small" onClick={() => onMark(inv, 'Sent')}>Mark as Sent</button>}
          <button className="nmyt-btn secondary small" onClick={() => onEdit(inv)}>Edit</button>
          <button className="nmyt-btn secondary small" onClick={() => onDuplicate(inv)}>Duplicate</button>
          <button className="nmyt-btn secondary small" onClick={() => window.print()}>Print</button>
          <button className="nmyt-btn small" onClick={onDownloadPDF}>Download PDF</button>
        </div>
      </div>
      <div className="invoice-doc print-target" ref={invRef}>
        {inv.status === 'Paid' && <div className="stamp">PAID</div>}
        <div className="inv-head">
          <div>
            <div className="brandname">{settings.company_name || 'Nmyt'}</div>
            <div className="brandsub">{inv.wing}</div>
          </div>
          <div>
            <div className="inv-title">INVOICE</div>
            <table className="meta-table" style={{ marginTop: 8 }}><tbody>
              <tr><td>Invoice No.</td><td>{inv.number}</td></tr>
              <tr><td>Date</td><td>{inv.date}</td></tr>
              <tr><td>Due Date</td><td>{inv.due_date || '—'}</td></tr>
            </tbody></table>
          </div>
        </div>
        <div className="parties">
          <div>
            <div className="party-label">Billed By</div>
            <div><strong>{settings.company_name || 'Nmyt'}</strong></div>
            <div style={{ fontSize: 12, color: '#666' }}>{settings.address || ''}</div>
            <div style={{ fontSize: 12, color: '#666' }}>{settings.gstin ? 'GSTIN: ' + settings.gstin : ''}</div>
          </div>
          <div>
            <div className="party-label">Billed To</div>
            <div><strong>{inv.client_name || '—'}</strong></div>
            <div style={{ fontSize: 12, color: '#666' }}>{inv.client_address || ''}</div>
            <div style={{ fontSize: 12, color: '#666' }}>{inv.client_contact || ''}</div>
          </div>
        </div>
        <table className="items">
          <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={i}><td>{it.desc || '—'}</td><td>{it.qty}</td><td>{fmtMoney(it.rate)}</td><td style={{ textAlign: 'right' }}>{fmtMoney((Number(it.qty) || 0) * (Number(it.rate) || 0))}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="totals">
          <div><span>Subtotal</span><span>{fmtMoney(totals.subtotal)}</span></div>
          <div><span>Tax ({inv.tax_rate}%)</span><span>{fmtMoney(totals.tax)}</span></div>
          <div className="grand"><span>Total Due</span><span>{fmtMoney(totals.total)}</span></div>
        </div>
        <div className="footnote">{inv.notes || settings.bank_details || ''}</div>
      </div>
    </>
  );
}

// ================================================================
// CRM
// ================================================================
function CrmView({ crm, summary, weightedValue, onAdd, onStage, onDelete }) {
  const [form, setForm] = useState({ client_name: '', contact: '', wing: 'Tech Solutions', stage: 'Lead', deal_value: 0, probability: 20, next_follow_up: '', owner: '', notes: '' });
  const rows = [...crm].sort((a, b) => (a.next_follow_up || '9999').localeCompare(b.next_follow_up || '9999'));

  function submit() {
    if (!form.client_name.trim()) return;
    onAdd(form);
    setForm({ client_name: '', contact: '', wing: 'Tech Solutions', stage: 'Lead', deal_value: 0, probability: 20, next_follow_up: '', owner: '', notes: '' });
  }

  return (
    <>
      <div className="nmyt-section-head"><h2>Client Pipeline &amp; CRM</h2></div>
      <div className="nmyt-grid cols-3">
        <div className="nmyt-card"><div className="nmyt-card-title">Total Pipeline (excl. Lost)</div><div className="nmyt-stat-value gold">{fmtMoney(summary.pipeline)}</div></div>
        <div className="nmyt-card"><div className="nmyt-card-title">Weighted Pipeline</div><div className="nmyt-stat-value">{fmtMoney(summary.weighted)}</div></div>
        <div className="nmyt-card"><div className="nmyt-card-title">Won (Paid) Total</div><div className="nmyt-stat-value pos">{fmtMoney(summary.won)}</div></div>
      </div>
      <div className="nmyt-card">
        <div className="nmyt-card-title">Add Opportunity</div>
        <div className="nmyt-row3">
          <div className="nmyt-field"><label>Client Name</label><input className="nmyt-input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></div>
          <div className="nmyt-field"><label>Contact</label><input className="nmyt-input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
          <div className="nmyt-field"><label>Wing</label>
            <select className="nmyt-select" value={form.wing} onChange={(e) => setForm({ ...form, wing: e.target.value })}>
              {['Tech Solutions', 'Content Production', 'Both'].map((w) => <option key={w}>{w}</option>)}
            </select>
          </div>
        </div>
        <div className="nmyt-row4">
          <div className="nmyt-field"><label>Stage</label>
            <select className="nmyt-select" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
              {STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="nmyt-field"><label>Deal Value (₹)</label><input type="number" min="0" className="nmyt-input" value={form.deal_value} onChange={(e) => setForm({ ...form, deal_value: Number(e.target.value) })} /></div>
          <div className="nmyt-field"><label>Probability %</label><input type="number" min="0" max="100" className="nmyt-input" value={form.probability} onChange={(e) => setForm({ ...form, probability: Number(e.target.value) })} /></div>
          <div className="nmyt-field"><label>Next Follow-up</label><input type="date" className="nmyt-input" value={form.next_follow_up} onChange={(e) => setForm({ ...form, next_follow_up: e.target.value })} /></div>
        </div>
        <div className="nmyt-row2">
          <div className="nmyt-field"><label>Owner</label><input className="nmyt-input" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></div>
          <div className="nmyt-field"><label>Notes</label><input className="nmyt-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <button className="nmyt-btn" onClick={submit}>Add to Pipeline</button>
      </div>
      <div className="nmyt-card">
        {rows.length === 0 ? <Empty title="No opportunities yet" sub="Add your first lead above." /> : (
          <table className="nmyt-table">
            <thead><tr><th>Client</th><th>Wing</th><th>Stage</th><th className="nmyt-num">Deal Value</th><th className="nmyt-num">Weighted</th><th>Next Follow-up</th><th>Owner</th><th></th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{e.client_name || '—'}</td><td>{e.wing}</td>
                  <td>
                    <select className="nmyt-select" style={{ width: 'auto' }} value={e.stage} onChange={(ev) => onStage(e.id, ev.target.value)}>
                      {STAGES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="nmyt-num">{fmtMoney(e.deal_value)}</td>
                  <td className="nmyt-num">{fmtMoney(weightedValue(e))}</td>
                  <td>{e.next_follow_up || '—'}</td>
                  <td>{e.owner || '—'}</td>
                  <td><button className="icon-btn" onClick={() => onDelete(e.id)} title="Delete">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ================================================================
// Team & Salaries
// ================================================================
function TeamView({ team, ledger, onAdd, onToggle, onDelete, onPay }) {
  const [form, setForm] = useState({ name: '', role: '', wing: 'Tech Solutions', type: 'Core Team', payout_rate: 0, payout_basis: 'Monthly', contact: '', active: true });
  const rows = [...team].sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1));
  const monthlyTotal = team.filter((m) => m.active && m.payout_basis === 'Monthly').reduce((s, m) => s + (Number(m.payout_rate) || 0), 0);
  const totalPaidOut = ledger.filter((r) => r.type === 'Expense' && (r.category === 'Salary' || r.category === 'Contractor')).reduce((s, r) => s + (Number(r.amount) || 0), 0);

  function submit() {
    if (!form.name.trim()) return;
    onAdd(form);
    setForm({ name: '', role: '', wing: 'Tech Solutions', type: 'Core Team', payout_rate: 0, payout_basis: 'Monthly', contact: '', active: true });
  }

  return (
    <>
      <div className="nmyt-section-head"><h2>Team &amp; Salaries</h2></div>
      <div className="nmyt-grid cols-3">
        <div className="nmyt-card"><div className="nmyt-card-title">Active People</div><div className="nmyt-stat-value">{team.filter((m) => m.active).length}</div></div>
        <div className="nmyt-card"><div className="nmyt-card-title">Monthly Payroll (fixed)</div><div className="nmyt-stat-value neg">{fmtMoney(monthlyTotal)}</div></div>
        <div className="nmyt-card"><div className="nmyt-card-title">Total Paid Out (Salary + Contractor)</div><div className="nmyt-stat-value">{fmtMoney(totalPaidOut)}</div></div>
      </div>
      <div className="nmyt-card">
        <div className="nmyt-card-title">Add Team Member / Freelancer / Partner</div>
        <div className="nmyt-row3">
          <div className="nmyt-field"><label>Name</label><input className="nmyt-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="nmyt-field"><label>Role</label><input className="nmyt-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></div>
          <div className="nmyt-field"><label>Wing</label>
            <select className="nmyt-select" value={form.wing} onChange={(e) => setForm({ ...form, wing: e.target.value })}>
              {[...WINGS, 'Both'].map((w) => <option key={w}>{w}</option>)}
            </select>
          </div>
        </div>
        <div className="nmyt-row4">
          <div className="nmyt-field"><label>Type</label>
            <select className="nmyt-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TEAM_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="nmyt-field"><label>Payout Rate (₹)</label><input type="number" min="0" className="nmyt-input" value={form.payout_rate} onChange={(e) => setForm({ ...form, payout_rate: Number(e.target.value) })} /></div>
          <div className="nmyt-field"><label>Payout Basis</label>
            <select className="nmyt-select" value={form.payout_basis} onChange={(e) => setForm({ ...form, payout_basis: e.target.value })}>
              {PAYOUT_BASIS.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div className="nmyt-field"><label>Contact</label><input className="nmyt-input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
        </div>
        <button className="nmyt-btn" onClick={submit}>Add to Team</button>
      </div>
      <div className="nmyt-card">
        {rows.length === 0 ? <Empty title="No team members yet" sub="Add your first core member or freelancer above." /> : (
          <table className="nmyt-table">
            <thead><tr><th>Name</th><th>Role</th><th>Wing</th><th>Type</th><th className="nmyt-num">Rate</th><th>Basis</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td><td>{m.role}</td><td>{m.wing}</td><td>{m.type}</td>
                  <td className="nmyt-num">{fmtMoney(m.payout_rate)}</td><td>{m.payout_basis}</td>
                  <td><span className={`pill ${m.active ? 'yes' : 'no'}`}>{m.active ? 'Yes' : 'No'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="nmyt-btn secondary small" onClick={() => onPay(m)}>Pay Now</button>{' '}
                    <button className="nmyt-btn secondary small" onClick={() => onToggle(m)}>{m.active ? 'Deactivate' : 'Activate'}</button>{' '}
                    <button className="icon-btn" onClick={() => onDelete(m.id)} title="Delete">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="nmyt-hint">&quot;Pay Now&quot; logs a Salary (Core Team) or Contractor (Freelancer/Partner) expense to the Ledger for today, using that person&apos;s payout rate.</div>
    </>
  );
}

// ================================================================
// Ledger
// ================================================================
function LedgerView({ ledger, filter, setFilter, onAdd, onDelete, onExportCSV }) {
  const [form, setForm] = useState({ date: todayStr(), type: 'Income', wing: WINGS[0], category: CATEGORIES_INCOME[0], description: '', amount: '' });
  let rows = ledger;
  if (filter.wing !== 'All') rows = rows.filter((r) => r.wing === filter.wing);
  if (filter.type !== 'All') rows = rows.filter((r) => r.type === filter.type);
  if (filter.category !== 'All') rows = rows.filter((r) => r.category === filter.category);
  if (filter.search.trim()) {
    const q = filter.search.trim().toLowerCase();
    rows = rows.filter((r) => r.description.toLowerCase().includes(q));
  }
  const allCategories = [...CATEGORIES_INCOME, ...CATEGORIES_EXPENSE];

  function submit() {
    if (!form.description.trim() || !form.amount) return;
    onAdd({ date: form.date, description: form.description, wing: form.wing, category: form.category, type: form.type, amount: Number(form.amount) });
    setForm({ ...form, description: '', amount: '' });
  }

  return (
    <>
      <div className="nmyt-section-head"><h2>Income &amp; Expenses</h2><button className="nmyt-btn secondary small" onClick={onExportCSV}>Download CSV</button></div>
      <div className="nmyt-card">
        <div className="nmyt-card-title">Add Entry</div>
        <div className="nmyt-row4">
          <div className="nmyt-field"><label>Date</label><input type="date" className="nmyt-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="nmyt-field"><label>Type</label>
            <select className="nmyt-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option>Income</option><option>Expense</option>
            </select>
          </div>
          <div className="nmyt-field"><label>Wing</label>
            <select className="nmyt-select" value={form.wing} onChange={(e) => setForm({ ...form, wing: e.target.value })}>
              {WINGS.map((w) => <option key={w}>{w}</option>)}
            </select>
          </div>
          <div className="nmyt-field"><label>Category</label>
            <select className="nmyt-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {allCategories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="nmyt-row3">
          <div className="nmyt-field"><label>Description</label><input className="nmyt-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What was this for?" /></div>
          <div className="nmyt-field"><label>Amount (₹)</label><input type="number" min="0" className="nmyt-input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <div style={{ alignSelf: 'end' }}><button className="nmyt-btn" onClick={submit} style={{ width: '100%' }}>Add Entry</button></div>
        </div>
      </div>
      <div className="nmyt-card">
        <div className="nmyt-row4">
          <div className="nmyt-field"><label>Search</label><input className="nmyt-input" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} placeholder="Description" /></div>
          <div className="nmyt-field"><label>Wing</label>
            <select className="nmyt-select" value={filter.wing} onChange={(e) => setFilter({ ...filter, wing: e.target.value })}>
              {['All', ...WINGS].map((w) => <option key={w}>{w}</option>)}
            </select>
          </div>
          <div className="nmyt-field"><label>Type</label>
            <select className="nmyt-select" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
              {['All', 'Income', 'Expense'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="nmyt-field"><label>Category</label>
            <select className="nmyt-select" value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
              {['All', ...allCategories].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="nmyt-card">
        {rows.length === 0 ? <Empty title="No transactions match" sub="Add a transaction above or clear your filters." /> : (
          <table className="nmyt-table">
            <thead><tr><th>Date</th><th>Description</th><th>Wing</th><th>Category</th><th>Type</th><th className="nmyt-num">Amount</th><th className="nmyt-num">Balance</th><th></th></tr></thead>
            <tbody>
              {rows.slice().reverse().map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td><td>{r.description}</td><td>{r.wing}</td><td>{r.category}</td>
                  <td><span className={`pill ${r.type.toLowerCase()}`}>{r.type}</span></td>
                  <td className="nmyt-num">{fmtMoney(r.amount)}</td>
                  <td className="nmyt-num">{fmtMoney(r.balance)}</td>
                  <td><button className="icon-btn" onClick={() => onDelete(r.id)} title="Delete">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ================================================================
// Reports — P&L + Balance Sheet, each downloadable as its own PDF
// ================================================================
function ReportsView({ period, setPeriod, pl, totals, receivables, settings, plRef, bsRef, onDownloadPL, onDownloadBS }) {
  const totalAssets = totals.net + receivables;
  const liabilities = 0;
  const equity = totalAssets - liabilities;
  const revCats = Object.keys(pl.revenueByCategory);
  const expCats = Object.keys(pl.expenseByCategory);
  const periodLabel = pl.from === '0000-01-01' ? 'All recorded transactions' : `${pl.from} to ${pl.to}`;

  return (
    <>
      <div className="nmyt-section-head"><h2>Profit &amp; Loss Statement</h2>
        <button className="nmyt-btn small no-print" onClick={onDownloadPL}>Download PDF</button>
      </div>
      <div className="nmyt-card no-print">
        <div className="nmyt-row3">
          <div className="nmyt-field"><label>Period</label>
            <select className="nmyt-select" value={period.preset} onChange={(e) => setPeriod({ ...period, preset: e.target.value })}>
              <option value="all">All Time</option>
              <option value="this-month">This Month</option>
              <option value="last-month">Last Month</option>
              <option value="this-year">This Year</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          {period.preset === 'custom' && (
            <>
              <div className="nmyt-field"><label>From</label><input type="date" className="nmyt-input" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></div>
              <div className="nmyt-field"><label>To</label><input type="date" className="nmyt-input" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></div>
            </>
          )}
        </div>
      </div>

      <div className="report-doc print-target" ref={plRef}>
        <div className="report-brand">{settings.company_name || 'Nmyt'}</div>
        <h2>Profit &amp; Loss Statement</h2>
        <p style={{ color: '#8a8778', fontSize: 12 }}>{periodLabel}</p>

        <h3>Revenue</h3>
        <table>
          <tbody>
            {revCats.length ? revCats.map((c) => <tr key={c}><td>{c}</td><td style={{ textAlign: 'right' }}>{fmtMoney(pl.revenueByCategory[c])}</td></tr>) : <tr><td colSpan={2} style={{ color: '#8a8778' }}>No income in this period</td></tr>}
            <tr className="grand-row"><td>Total Revenue</td><td style={{ textAlign: 'right' }}>{fmtMoney(pl.revenue)}</td></tr>
          </tbody>
        </table>

        <h3>Expenses</h3>
        <table>
          <tbody>
            {expCats.length ? expCats.map((c) => <tr key={c}><td>{c}</td><td style={{ textAlign: 'right' }}>{fmtMoney(pl.expenseByCategory[c])}</td></tr>) : <tr><td colSpan={2} style={{ color: '#8a8778' }}>No expenses in this period</td></tr>}
            <tr className="grand-row"><td>Total Expenses</td><td style={{ textAlign: 'right' }}>{fmtMoney(pl.expense)}</td></tr>
          </tbody>
        </table>

        <table>
          <tbody>
            <tr className="grand-row"><td>Net Profit</td><td style={{ textAlign: 'right' }}>{fmtMoney(pl.net)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="nmyt-section-head"><h2>Balance Sheet <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'Inter,sans-serif' }}>(as of today)</span></h2>
        <button className="nmyt-btn small no-print" onClick={onDownloadBS}>Download PDF</button>
      </div>
      <div className="report-doc print-target" ref={bsRef}>
        <div className="report-brand">{settings.company_name || 'Nmyt'}</div>
        <h2>Balance Sheet</h2>
        <p style={{ color: '#8a8778', fontSize: 12 }}>As of {todayStr()}</p>

        <h3>Assets</h3>
        <table>
          <tbody>
            <tr><td>Cash Balance</td><td style={{ textAlign: 'right' }}>{fmtMoney(totals.net)}</td></tr>
            <tr><td>Accounts Receivable (invoices Sent, not yet Paid)</td><td style={{ textAlign: 'right' }}>{fmtMoney(receivables)}</td></tr>
            <tr className="grand-row"><td>Total Assets</td><td style={{ textAlign: 'right' }}>{fmtMoney(totalAssets)}</td></tr>
          </tbody>
        </table>

        <h3>Liabilities</h3>
        <table>
          <tbody>
            <tr><td>Total Liabilities (not tracked in this tool)</td><td style={{ textAlign: 'right' }}>{fmtMoney(liabilities)}</td></tr>
          </tbody>
        </table>

        <table>
          <tbody>
            <tr className="grand-row"><td>Owner&apos;s Equity</td><td style={{ textAlign: 'right' }}>{fmtMoney(equity)}</td></tr>
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: '#8a8778' }}>This is a simplified snapshot built from invoices and ledger data — useful for day-to-day tracking, not a substitute for a formal, audited balance sheet.</p>
      </div>
    </>
  );
}

// ================================================================
// Settings
// ================================================================
function SettingsView({ settings, onSave, onExportBackup }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);

  return (
    <>
      <div className="nmyt-section-head"><h2>Company Settings</h2></div>
      <div className="nmyt-card">
        <div className="nmyt-row2">
          <div className="nmyt-field"><label>Company Name</label><input className="nmyt-input" value={form.company_name || ''} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></div>
          <div className="nmyt-field"><label>Default Tax / GST %</label><input type="number" className="nmyt-input" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} /></div>
        </div>
        <div className="nmyt-field"><label>Address</label><input className="nmyt-input" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <div className="nmyt-row2">
          <div className="nmyt-field"><label>GSTIN (optional)</label><input className="nmyt-input" value={form.gstin || ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
          <div className="nmyt-field"><label>Next Invoice No.</label><input type="number" min="1" className="nmyt-input" value={form.next_invoice_number} onChange={(e) => setForm({ ...form, next_invoice_number: Number(e.target.value) })} /></div>
        </div>
        <div className="nmyt-field"><label>Bank / Payment Details</label><textarea className="nmyt-textarea" rows={3} value={form.bank_details || ''} onChange={(e) => setForm({ ...form, bank_details: e.target.value })} /></div>
        <button className="nmyt-btn" onClick={() => onSave(form)}>Save Settings</button>
        <div className="nmyt-hint">These details appear on every new invoice and report you generate. Shared across everyone signed in.</div>
      </div>

      <div className="nmyt-section-head"><h2>Backup</h2></div>
      <div className="nmyt-card">
        <div className="nmyt-hint" style={{ marginBottom: 14 }}>Your data lives in Supabase and is shared across your whole team automatically — this is just an extra safety copy.</div>
        <button className="nmyt-btn secondary small" onClick={onExportBackup}>Download Backup (.json)</button>
      </div>
    </>
  );
}
