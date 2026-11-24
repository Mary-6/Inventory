import React from 'react';

export const fmt = n => `${Math.round(Number(n) || 0).toLocaleString('en-US')} FCFA`;
export const num = n => `${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
export const dstr = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const ddate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function Stat({ label, value, sub, tone = 'navy' }) {
  const tones = { navy: 'text-navy-900', gold: 'text-gold-600', green: 'text-emerald-700', red: 'text-red-600' };
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-navy-600">{label}</div>
      <div className={`mt-1 text-2xl font-bold font-display ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-navy-600">{sub}</div>}
    </div>
  );
}

export function Badge({ status }) {
  const map = { paid: 'bg-emerald-100 text-emerald-800', partial: 'bg-amber-100 text-amber-800', unpaid: 'bg-red-100 text-red-700', received: 'bg-emerald-100 text-emerald-800', voided: 'bg-gray-200 text-gray-600' };
  return <span className={`badge ${map[status] || 'bg-navy-100 text-navy-700'}`}>{status}</span>;
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/50 p-4" onClick={onClose}>
      <div className={`card w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto p-5`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-bold text-navy-900">{title}</h3>
          <button className="text-navy-600 hover:text-navy-900 text-xl leading-none" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

export function Empty({ msg = 'No records found' }) {
  return <div className="py-10 text-center text-sm text-navy-600">{msg}</div>;
}

export function Spinner() {
  return <div className="py-10 text-center"><div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" /></div>;
}

export function PasswordInput({ value, onChange, required, minLength, placeholder, autoFocus }) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <input className="input pr-10" type={show ? 'text' : 'password'} value={value} onChange={onChange}
        required={required} minLength={minLength} placeholder={placeholder} autoFocus={autoFocus} />
      <button type="button" tabIndex={-1} onClick={() => setShow(!show)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-navy-600 hover:text-gold-600"
        title={show ? 'Hide password' : 'Show password'}>
        {show ? '🙈' : '👁'}
      </button>
    </div>
  );
}

export function useForm(init) {
  const [form, setForm] = React.useState(init);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return [form, set, setForm];
}
