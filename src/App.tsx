import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  clearRemoteExpedientes,
  getHealth,
  isOfflineNow,
  isSimulatedOffline,
  setSimulatedOffline,
  subscribeConnectivity,
} from './api/client';
import { TopNav, type AppRoute } from './components/TopNav';
import type { ExpedienteAuditadoRecord, HealthResponse } from './contracts/schemas';
import { useTheme } from './hooks/useNodux';
import { flushOfflineQueue } from './services/auditService';
import {
  clearExpedientes,
  listExpedientes,
  listOfflineQueue,
  subscribeSync,
} from './storage/db';

interface CampoProps {
  offline: boolean;
  onOpenConsola: (expedienteId?: string) => void;
  onToast: (message: string) => void;
}

interface ConsolaProps {
  offline: boolean;
  initialExpedienteId: string | null;
  onClearInitialExpediente: () => void;
  onOpenCampo: () => void;
  onToast: (message: string) => void;
}

interface ExecModalProps {
  open: boolean;
  expedientes: ExpedienteAuditadoRecord[];
  onClose: () => void;
  onClearBoard: () => Promise<void>;
  onBoardChanged: () => Promise<void>;
  onToast: (msg: string) => void;
}

function resolveRoute(pathname: string): AppRoute {
  if (pathname.startsWith('/campo')) return '/campo';
  return '/consola';
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [route, setRoute] = useState<AppRoute>(() => resolveRoute(window.location.pathname));
  const [CampoComponent, setCampoComponent] = useState<ComponentType<CampoProps> | null>(null);
  const [ConsolaComponent, setConsolaComponent] = useState<ComponentType<ConsolaProps> | null>(
    null
  );
  const [ExecutiveComponent, setExecutiveComponent] =
    useState<ComponentType<ExecModalProps> | null>(null);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [offline, setOffline] = useState<boolean>(() => isOfflineNow());
  const [simOffline, setSimOffline] = useState<boolean>(() => isSimulatedOffline());
  const [queueCount, setQueueCount] = useState<number>(0);
  const [expedientes, setExpedientes] = useState<ExpedienteAuditadoRecord[]>([]);
  const [pendingDrawerExpId, setPendingDrawerExpId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Acceso Gerencial con PIN 1234 (patrón Nodux Flow: botón Gerencia, triple-tap logo, ?admin=true o #admin)
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [execOpen, setExecOpen] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Normalizar ruta raíz "/" -> "/consola" y detectar ?admin=true / #admin
  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', '/consola');
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === 'true' || window.location.hash === '#admin') {
      setPinInput('');
      setPinError(false);
      setPinModalOpen(true);
    }
    const onPopState = () => setRoute(resolveRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Code-splitting por ruta: Plano 1 (/campo) nunca carga los módulos de Plano 2 ni Panel Gerencial
  useEffect(() => {
    if (route === '/campo' && !CampoComponent) {
      import('./views/CampoView').then((mod) => setCampoComponent(() => mod.default));
    } else if (route === '/consola' && !ConsolaComponent) {
      import('./views/ConsolaView').then((mod) => setConsolaComponent(() => mod.default));
    }
  }, [route, CampoComponent, ConsolaComponent]);

  const refreshCounts = async () => {
    const [q, exps] = await Promise.all([listOfflineQueue(), listExpedientes()]);
    setQueueCount(q.length);
    setExpedientes(exps);
  };

  const checkHealth = async () => {
    if (isOfflineNow()) {
      setHealth(null);
      return;
    }
    try {
      const h = await getHealth();
      setHealth(h);
    } catch {
      setHealth(null);
    }
  };

  useEffect(() => {
    refreshCounts();
    checkHealth();

    const unsubSync = subscribeSync(() => {
      refreshCounts();
    });

    const unsubConn = subscribeConnectivity(async (nowOffline) => {
      setOffline(nowOffline);
      setSimOffline(isSimulatedOffline());
      if (!nowOffline) {
        await checkHealth();
        const res = await flushOfflineQueue();
        await refreshCounts();
        if (res.synced.length > 0) {
          showToast(
            `Señal recuperada: ${res.synced.length} expediente(s) sincronizado(s) desde cola offline.`
          );
        }
      } else {
        setHealth(null);
      }
    });

    return () => {
      unsubSync();
      unsubConn();
    };
  }, []);

  const navigate = (next: AppRoute) => {
    if (window.location.pathname !== next) {
      window.history.pushState({}, '', next);
    }
    setRoute(next);
  };

  const handleToggleSimulatedOffline = () => {
    const next = !simOffline;
    setSimulatedOffline(next);
    showToast(
      next
        ? 'Modo sin señal activado (simulación El Porvenir / Hermelinda).'
        : 'Señal restaurada hacia el VPS Soberano.'
    );
  };

  const handleRequestExecutive = () => {
    setPinInput('');
    setPinError(false);
    setPinModalOpen(true);
  };

  const handleVerifyPin = (e: Event) => {
    e.preventDefault();
    if (pinInput.trim() === '1234') {
      setPinModalOpen(false);
      setPinInput('');
      setPinError(false);
      setExecOpen(true);
      if (!ExecutiveComponent) {
        import('./components/ExecutiveModal').then((mod) => setExecutiveComponent(() => mod.default));
      }
    } else {
      setPinError(true);
    }
  };

  return (
    <>
      <TopNav
        route={route}
        onNavigate={navigate}
        health={health}
        offline={offline}
        simulatedOffline={simOffline}
        onToggleSimulatedOffline={handleToggleSimulatedOffline}
        queueCount={queueCount}
        expedientesCount={expedientes.length}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenExecutive={handleRequestExecutive}
      />

      {route === '/campo' ? (
        CampoComponent ? (
          <CampoComponent
            offline={offline}
            onOpenConsola={(expId) => {
              if (expId) setPendingDrawerExpId(expId);
              navigate('/consola');
            }}
            onToast={showToast}
          />
        ) : (
          <div class="page-shell" style={{ color: 'var(--ink-muted)' }}>
            Cargando Terminal Móvil Campo (PWA)…
          </div>
        )
      ) : ConsolaComponent ? (
        <ConsolaComponent
          offline={offline}
          initialExpedienteId={pendingDrawerExpId}
          onClearInitialExpediente={() => setPendingDrawerExpId(null)}
          onOpenCampo={() => navigate('/campo')}
          onToast={showToast}
        />
      ) : (
        <div class="page-shell" style={{ color: 'var(--ink-muted)' }}>
          Cargando Consola Riesgos SBS…
        </div>
      )}

      {/* Modal PIN Gerencial (1234, patrón Nodux Flow) */}
      {pinModalOpen && (
        <div
          class="modal-backdrop print-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Acceso Panel Gerencial"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPinModalOpen(false);
          }}
        >
          <form class="modal-card modal-sm" onSubmit={handleVerifyPin}>
            <div class="modal-head">
              <div>
                <h2 class="card-h">Acceso Gerencial Riesgos</h2>
                <div class="card-sub">Ingresa PIN de auditoría (demo: 1234)</div>
              </div>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                onClick={() => setPinModalOpen(false)}
                aria-label="Cerrar PIN"
              >
                ×
              </button>
            </div>
            <div class="modal-body">
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                class="search-input mono"
                style={{ width: '100%', textAlign: 'center', fontSize: '20px', letterSpacing: '0.3em' }}
                placeholder="••••"
                value={pinInput}
                onInput={(e) => {
                  setPinInput((e.currentTarget as HTMLInputElement).value);
                  setPinError(false);
                }}
              />
              {pinError && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--red-dark)', textAlign: 'center', fontWeight: 700 }}>
                  PIN incorrecto. Usa 1234 para modo demostración.
                </div>
              )}
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary btn-sm" onClick={() => setPinModalOpen(false)}>
                Cancelar
              </button>
              <button type="submit" class="btn btn-primary btn-sm">
                Desbloquear Panel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Panel Gerencial Nodux Flow (lazy-loaded) */}
      {execOpen && ExecutiveComponent && (
        <ExecutiveComponent
          open={execOpen}
          expedientes={expedientes}
          onClose={() => setExecOpen(false)}
          onClearBoard={async () => {
            await clearRemoteExpedientes();
            await clearExpedientes();
            await refreshCounts();
          }}
          onBoardChanged={refreshCounts}
          onToast={showToast}
        />
      )}

      {toast && (
        <div class="toast print-hidden" role="status" aria-live="polite">
          <span class="pulse-dot" />
          <span>{toast}</span>
        </div>
      )}
    </>
  );
}
