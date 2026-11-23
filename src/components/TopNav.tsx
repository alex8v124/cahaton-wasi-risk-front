import { useRef } from 'preact/hooks';
import type { HealthResponse } from '../contracts/schemas';
import { IS_LIVE_VPS } from '../api/client';
import type { AppTheme } from '../hooks/useNodux';

export type AppRoute = '/campo' | '/consola';

interface TopNavProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  health: HealthResponse | null;
  offline: boolean;
  simulatedOffline: boolean;
  onToggleSimulatedOffline: () => void;
  queueCount: number;
  expedientesCount: number;
  theme: AppTheme;
  onToggleTheme: () => void;
  onOpenExecutive: () => void;
}

export function TopNav({
  route,
  onNavigate,
  health,
  offline,
  simulatedOffline,
  onToggleSimulatedOffline,
  queueCount,
  expedientesCount,
  theme,
  onToggleTheme,
  onOpenExecutive,
}: TopNavProps) {
  const tapRef = useRef({ count: 0, last: 0 });

  // Triple-tap en logo abre Panel Gerencial (patrón Nodux Flow)
  const handleLogoClick = () => {
    const now = Date.now();
    if (now - tapRef.current.last < 1500) {
      tapRef.current.count += 1;
    } else {
      tapRef.current.count = 1;
    }
    tapRef.current.last = now;
    if (tapRef.current.count >= 3) {
      tapRef.current.count = 0;
      onOpenExecutive();
    }
  };

  return (
    <header class="topnav print-hidden">
      <div class="topnav-inner">
        <div
          class="brand"
          onClick={handleLogoClick}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          title="WASI-RISK AI · Triple clic abre Panel Gerencial (PIN 1234)"
        >
          <div class="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2.5L19.5 5.8V12C19.5 16.9 16.3 20.6 12 22C7.7 20.6 4.5 16.9 4.5 12V5.8L12 2.5Z"
                stroke="#ffffff"
                stroke-width="2"
                stroke-linejoin="round"
              />
              <path
                d="M8.8 12.2L11 14.4L15.6 9.8"
                stroke="#34D399"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <div>
            <div class="brand-title">
              <span>WASI-RISK AI</span>
              <span style={{ opacity: 0.35 }}>·</span>
              <span style={{ fontWeight: 600, color: 'var(--ink-secondary)' }}>Caja Trujillo</span>
            </div>
            <div class="brand-sub">Auditoría Pre-Desembolso SBS (PEN S/)</div>
          </div>
        </div>

        <nav class="route-tabs" aria-label="Planos Frontend">
          <button
            type="button"
            class={`route-tab ${route === '/campo' ? 'active' : ''}`}
            onClick={() => onNavigate('/campo')}
          >
            <span>Campo PWA</span>
            {queueCount > 0 && <span class="route-badge">{queueCount} cola</span>}
          </button>
          <button
            type="button"
            class={`route-tab ${route === '/consola' ? 'active' : ''}`}
            onClick={() => onNavigate('/consola')}
          >
            <span>Consola Riesgos</span>
            <span class="route-badge">{expedientesCount}</span>
          </button>
        </nav>

        <div class="nav-telemetry">
          <span
            class={`status-pill ${offline ? 'offline' : 'online'}`}
            title={health?.modo_activo ?? 'Verificando VPS Soberano de Soe'}
          >
            <span class={`pulse-dot ${offline ? 'offline' : ''}`} />
            {offline ? (
              <span>Offline · El Porvenir</span>
            ) : (
              <span>
                VPS Soberano Online
                {health?.latencia_ms !== undefined ? ` · ${health.latencia_ms.toFixed(0)} ms` : ''}
                {!IS_LIVE_VPS ? ' (Demo)' : ''}
              </span>
            )}
          </span>

          <span
            class="status-pill sovereign"
            title="Regla SBS Art. 140: el frontend jamás llama a APIs externas de IA. Todo pasa por el VPS de Soe."
          >
            Art. 140 PII
          </span>

          <button
            type="button"
            class={`offline-toggle-btn ${simulatedOffline ? 'active' : ''}`}
            onClick={onToggleSimulatedOffline}
            title="Simular pérdida de señal móvil en campo (El Porvenir / Hermelinda)"
          >
            {simulatedOffline ? 'Reconectar señal' : 'Simular sin señal'}
          </button>

          <button
            type="button"
            class="offline-toggle-btn"
            onClick={onOpenExecutive}
            title="Abrir Panel Gerencial Nodux Flow (PIN 1234)"
          >
            Gerencia
          </button>

          <button
            type="button"
            class="theme-toggle-btn"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
    </header>
  );
}
