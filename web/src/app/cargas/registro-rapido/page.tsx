'use client';

import { useState, useEffect, useMemo, FormEvent } from 'react';
import axios from 'axios';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, CheckCircle2, Fuel, Search, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import TurnstileWidget from '@/components/TurnstileWidget';

const API = process.env.NEXT_PUBLIC_API_URL || '';
// Site key de Turnstile (build-time). Si está vacío (dev), no se muestra el
// captcha y el backend omite la verificación en development.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

type Station = { id: number; legalName: string; tradeName?: string | null };
type VerifyResponse = {
  vehicle: { id: number; plate: string; economicNumber: string; classification: string; type: string };
  operator: { fullName: string } | null;
  budget: { base: number; rollover: number; spent: number; available: number | null; cutOff: boolean } | null;
};

export default function RegistroRapidoPage() {
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [stations, setStations] = useState<Station[]>([]);

  // Form state
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [economicNumber, setEconomicNumber] = useState('');
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [stationId, setStationId] = useState<number | ''>('');
  const [amount, setAmount] = useState<string>('');
  const [liters, setLiters] = useState<string>('');
  const [odometer, setOdometer] = useState<string>('');
  const [odometerNF, setOdometerNF] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState<{ folio: number; available: number | null } | null>(null);

  // Token de Turnstile (captcha). turnstileKey remonta el widget para obtener un
  // token nuevo tras un submit (el token es de un solo uso).
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileKey, setTurnstileKey] = useState(0);
  const turnstileRequired = !!TURNSTILE_SITE_KEY;

  // Carga inicial: CSRF token + gasolineras
  useEffect(() => {
    axios.get(`${API}/api/public/session-token`).then((r) => setCsrfToken(r.data.csrfToken));
    axios.get(`${API}/api/public/stations`).then((r) => setStations(r.data.data));
  }, []);

  async function handleVerify() {
    if (!employeeNumber.trim() || !economicNumber.trim()) return;
    setVerifying(true);
    setVerifyError('');
    setVerifyData(null);
    try {
      const r = await axios.get(`${API}/api/public/verify`, {
        params: { employeeNumber: employeeNumber.trim(), economicNumber: economicNumber.trim() },
      });
      setVerifyData(r.data);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error al verificar';
      setVerifyError(msg);
    } finally {
      setVerifying(false);
    }
  }

  const available = verifyData?.budget?.available ?? null;
  const amountNum = Number(amount);
  const exceeds = useMemo(() => {
    if (available === null) return false; // sin presupuesto declarado: el backend decide
    if (!Number.isFinite(amountNum) || amountNum <= 0) return false; // monto vacío/no válido
    return amountNum > available; // available=0 bloquea cualquier monto positivo
  }, [available, amountNum]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError('');
    setSubmitting(true);
    try {
      const payload = {
        csrfToken,
        turnstileToken,
        vehicleEconomicNumber: economicNumber.trim(),
        operatorEmployee: employeeNumber.trim(),
        operatorName: verifyData?.operator?.fullName || '',
        stationId: Number(stationId),
        amount: Number(amount),
        liters: liters ? Number(liters) : null,
        odometerStatus: odometerNF ? 'NF' : 'OK',
        odometer: odometerNF ? null : Number(odometer),
      };
      const r = await axios.post(`${API}/api/public/fuel-loads`, payload);
      setSuccess({ folio: r.data.data.folio, available: r.data.data.available });
    } catch (err) {
      const r = (err as { response?: { data?: { error?: string; available?: number } }; message?: string }).response;
      setSubmitError(r?.data?.error || (err as Error).message || 'Error al registrar');
      // El token de captcha es de un solo uso: tras un intento hay que renovarlo.
      if (turnstileRequired) {
        setTurnstileToken('');
        setTurnstileKey((k) => k + 1);
      }
      // Si fue por presupuesto, refrescar verify
      if (r?.data?.available !== undefined) {
        handleVerify();
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Pantalla de éxito
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="size-14 rounded-full bg-success/15 flex items-center justify-center">
              <CheckCircle2 className="size-7 text-success" />
            </div>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Carga registrada</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Tu folio es <span className="font-mono font-semibold text-foreground">#{success.folio}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">Quedará pendiente de revisión por el supervisor.</p>
          {success.available != null && (
            <div className="mt-5 rounded-md bg-muted/40 px-4 py-3 text-left">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Presupuesto restante</p>
              <p className="font-mono text-lg font-semibold tabular-nums">${success.available.toLocaleString('es-MX')}</p>
            </div>
          )}
          <Button
            className="mt-6 w-full"
            onClick={() => {
              setSuccess(null);
              setAmount(''); setLiters(''); setOdometer(''); setOdometerNF(false);
              setStationId('');
              setTurnstileToken(''); setTurnstileKey((k) => k + 1);
              axios.get(`${API}/api/public/session-token`).then((r) => setCsrfToken(r.data.csrfToken));
            }}
          >
            Registrar otra carga
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header del portal */}
      <header className="border-b border-border/60 bg-card">
        <div className="mx-auto max-w-xl px-4 py-5 flex items-center gap-3">
          <div className="size-2.5 rounded-full bg-primary shadow-[0_0_0_4px_var(--primary-subtle)]" />
          <div>
            <div className="text-sm font-semibold tracking-tight">Flotillas · Registro rápido</div>
            <div className="text-xs text-muted-foreground">Operadores — no requiere contraseña</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-8 space-y-5">
        {/* PASO 1 — identificación */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold tracking-tight mb-1">1. Identifícate</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Ingresa tu número de empleado y el número económico del vehículo.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                No. de empleado
              </label>
              <Input
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value.toUpperCase())}
                placeholder="EMP-00001"
                disabled={!!verifyData}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                No. económico (unidad)
              </label>
              <Input
                value={economicNumber}
                onChange={(e) => setEconomicNumber(e.target.value.toUpperCase())}
                placeholder="ECO-0001"
                disabled={!!verifyData}
                autoComplete="off"
              />
            </div>
          </div>

          {!verifyData && (
            <Button
              onClick={handleVerify}
              disabled={!employeeNumber.trim() || !economicNumber.trim() || verifying}
              className="mt-4 w-full"
              size="lg"
            >
              {verifying ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              {verifying ? 'Verificando…' : 'Verificar'}
            </Button>
          )}

          {verifyError && (
            <div className="mt-4 flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2.5 text-sm">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span>{verifyError}</span>
            </div>
          )}

          {/* Info verificada */}
          {verifyData && (
            <div className="mt-4 space-y-3">
              <div className="rounded-md bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Unidad</div>
                <div className="font-mono text-sm font-semibold">{verifyData.vehicle.economicNumber} · {verifyData.vehicle.plate}</div>
                <div className="text-xs text-muted-foreground">{verifyData.vehicle.type} · {verifyData.vehicle.classification}</div>
                {verifyData.operator && (
                  <div className="text-xs text-muted-foreground mt-1">Operador: {verifyData.operator.fullName}</div>
                )}
              </div>

              {verifyData.budget && (
                <div className={cn(
                  'rounded-md p-3',
                  verifyData.budget.available && verifyData.budget.available > 0
                    ? 'bg-success/10 border border-success/20'
                    : 'bg-destructive/10 border border-destructive/20',
                )}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Presupuesto disponible</div>
                  <div className="font-mono text-xl font-semibold tabular-nums">
                    ${(verifyData.budget.available ?? 0).toLocaleString('es-MX')}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <div>Base: ${verifyData.budget.base.toLocaleString('es-MX')}</div>
                    {verifyData.budget.rollover > 0 && (
                      <div>Remanente del mes anterior: ${verifyData.budget.rollover.toLocaleString('es-MX')}</div>
                    )}
                    <div>Gastado: ${verifyData.budget.spent.toLocaleString('es-MX')}</div>
                  </div>
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setVerifyData(null); setEmployeeNumber(''); setEconomicNumber('');
                  setAmount(''); setLiters(''); setOdometer('');
                }}
              >
                Cambiar identificación
              </Button>
            </div>
          )}
        </Card>

        {/* PASO 2 — registro */}
        {verifyData && (
          <Card className="p-5">
            <h2 className="text-sm font-semibold tracking-tight mb-1">2. Datos de la carga</h2>
            <p className="text-xs text-muted-foreground mb-4">Completa los campos y envía.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                  Gasolinera
                </label>
                <select
                  value={stationId}
                  onChange={(e) => setStationId(e.target.value ? Number(e.target.value) : '')}
                  required
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <option value="">Seleccionar…</option>
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>{s.tradeName || s.legalName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                  Monto facturado ($)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className={cn('font-mono tabular-nums', exceeds && 'border-destructive ring-destructive/30')}
                />
                {exceeds && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="size-3" />
                    Excede presupuesto disponible (${(available ?? 0).toLocaleString('es-MX')})
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                  Litros (opcional)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={liters}
                  onChange={(e) => setLiters(e.target.value)}
                  className="font-mono tabular-nums"
                />
              </div>

              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center justify-between mb-1.5">
                  <span>Odómetro (km)</span>
                  <label className="flex items-center gap-1.5 text-xs normal-case font-normal text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={odometerNF}
                      onChange={(e) => { setOdometerNF(e.target.checked); if (e.target.checked) setOdometer(''); }}
                      className="accent-primary"
                    />
                    <span className="tracking-normal">NF (no funciona)</span>
                  </label>
                </label>
                <Input
                  type="number"
                  min="0"
                  value={odometerNF ? '' : odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  disabled={odometerNF}
                  required={!odometerNF}
                  placeholder={odometerNF ? 'N/A — marcado NF' : ''}
                  className="font-mono tabular-nums"
                />
              </div>

              {submitError && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2.5 text-sm">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              {turnstileRequired && (
                <TurnstileWidget key={turnstileKey} siteKey={TURNSTILE_SITE_KEY} onToken={setTurnstileToken} />
              )}

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={submitting || exceeds || !stationId || !amount || (!odometerNF && !odometer) || (turnstileRequired && !turnstileToken)}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Fuel className="size-4" />}
                {submitting ? 'Registrando…' : 'Registrar carga'}
              </Button>
            </form>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          La carga quedará <strong>pendiente de revisión</strong> por el supervisor.
        </p>
      </main>
    </div>
  );
}
