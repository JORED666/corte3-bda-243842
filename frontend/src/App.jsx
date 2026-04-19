// frontend/src/App.jsx
import { useState } from 'react';

const API = 'http://localhost:3001';

// =============================================================
// ROLES disponibles para el dropdown de login
// =============================================================
const ROLES = [
    { value: 'admin',      label: '👑 Administrador' },
    { value: 'recepcion',  label: '📋 Recepcionista' },
    { value: 'vet_lopez',  label: '🩺 Dr. López (vet 1)' },
    { value: 'vet_garcia', label: '🩺 Dra. García (vet 2)' },
    { value: 'vet_mendez', label: '🩺 Dr. Méndez (vet 3)' },
];

export default function App() {
    const [rol, setRol] = useState('admin');
    const [pantalla, setPantalla] = useState('login');

    return (
        <div style={{ fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto', padding: 24 }}>
            <h1>🐾 Clínica Veterinaria</h1>

            {/* ------------------------------------------------
                PANTALLA 1: Login con selección de rol
                Permite cambiar entre roles para probar RLS y GRANT
            ------------------------------------------------ */}
            <div style={{ background: '#f0f4ff', padding: 16, borderRadius: 8, marginBottom: 24 }}>
                <h2>Pantalla 1 — Selección de rol (Login)</h2>
                <label><strong>Rol activo: </strong></label>
                <select
                    value={rol}
                    onChange={e => setRol(e.target.value)}
                    style={{ padding: 8, fontSize: 16, marginLeft: 8 }}
                >
                    {ROLES.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                </select>
                <p style={{ color: '#555', marginTop: 8 }}>
                    El rol seleccionado se envía como header <code>x-rol</code> en cada request.
                    PostgreSQL aplica RLS y GRANT según ese rol.
                </p>
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                    <button onClick={() => setPantalla('mascotas')} style={btnStyle}>
                        🔍 Ir a Búsqueda de Mascotas
                    </button>
                    <button onClick={() => setPantalla('vacunacion')} style={btnStyle}>
                        💉 Ir a Vacunación Pendiente
                    </button>
                </div>
            </div>

            {pantalla === 'mascotas'  && <PantallaMascotas rol={rol} />}
            {pantalla === 'vacunacion' && <PantallaVacunacion rol={rol} />}
        </div>
    );
}

// =============================================================
// PANTALLA 2: Búsqueda de mascotas
// Superficie principal para intentar SQL injection.
// El input se manda al backend que lo parametriza en la query.
// =============================================================
function PantallaMascotas({ rol }) {
    const [busqueda, setBusqueda] = useState('');
    const [mascotas, setMascotas] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function buscar() {
        setLoading(true);
        setError('');
        try {
            // El input del usuario va como query param, el backend
            // lo recibe y lo pasa como parámetro posicional a pg.
            // NUNCA se concatena en el SQL.
            const res = await fetch(
                `${API}/mascotas?nombre=${encodeURIComponent(busqueda)}`,
                { headers: { 'x-rol': rol } }
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setMascotas(data);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{ background: '#fff8e1', padding: 16, borderRadius: 8, marginBottom: 24 }}>
            <h2>Pantalla 2 — Búsqueda de mascotas</h2>
            <p style={{ color: '#555' }}>
                Rol activo: <strong>{rol}</strong> — si eres veterinario, RLS filtra solo tus mascotas.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && buscar()}
                    placeholder="Nombre de mascota (prueba: ' OR '1'='1)"
                    style={{ padding: 8, flex: 1, fontSize: 14 }}
                />
                <button onClick={buscar} style={btnStyle} disabled={loading}>
                    {loading ? 'Buscando...' : 'Buscar'}
                </button>
            </div>

            {error && (
                <div style={{ background: '#ffebee', padding: 12, borderRadius: 4, color: '#c62828' }}>
                    ❌ Error del servidor: {error}
                </div>
            )}

            {mascotas.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: '#ffe082' }}>
                            <th style={thStyle}>ID</th>
                            <th style={thStyle}>Nombre</th>
                            <th style={thStyle}>Especie</th>
                            <th style={thStyle}>Dueño</th>
                            <th style={thStyle}>Teléfono</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mascotas.map(m => (
                            <tr key={m.id}>
                                <td style={tdStyle}>{m.id}</td>
                                <td style={tdStyle}>{m.nombre}</td>
                                <td style={tdStyle}>{m.especie}</td>
                                <td style={tdStyle}>{m.dueno}</td>
                                <td style={tdStyle}>{m.telefono}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {mascotas.length === 0 && !loading && !error && (
                <p style={{ color: '#888' }}>Escribe un nombre y presiona Buscar.</p>
            )}
        </div>
    );
}

// =============================================================
// PANTALLA 3: Vacunación pendiente (con caché Redis)
// Demuestra cache hit/miss. El primer click consulta la BD,
// el segundo hit devuelve resultado desde Redis en ~5ms.
// =============================================================
function PantallaVacunacion({ rol }) {
    const [datos, setDatos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [mensaje, setMensaje] = useState('');

    async function cargar() {
        setLoading(true);
        setError('');
        setMensaje('');
        const inicio = Date.now();
        try {
            const res = await fetch(`${API}/vacunacion-pendiente`, {
                headers: { 'x-rol': rol }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            const latencia = Date.now() - inicio;
            setDatos(data);
            setMensaje(`Latencia: ${latencia}ms — revisa los logs del servidor para ver [CACHE HIT] o [CACHE MISS]`);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{ background: '#e8f5e9', padding: 16, borderRadius: 8 }}>
            <h2>Pantalla 3 — Vacunación Pendiente (caché Redis)</h2>
            <p style={{ color: '#555' }}>
                Primera consulta: <strong>CACHE MISS</strong> → consulta BD (~100-300ms)<br />
                Segunda consulta inmediata: <strong>CACHE HIT</strong> → Redis (~5-20ms)
            </p>
            <button onClick={cargar} style={btnStyle} disabled={loading}>
                {loading ? 'Consultando...' : '🔄 Consultar vacunación pendiente'}
            </button>

            {mensaje && (
                <p style={{ color: '#1b5e20', marginTop: 8, fontStyle: 'italic' }}>{mensaje}</p>
            )}
            {error && (
                <div style={{ background: '#ffebee', padding: 12, borderRadius: 4, color: '#c62828', marginTop: 8 }}>
                    ❌ {error}
                </div>
            )}

            {datos.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
                    <thead>
                        <tr style={{ background: '#a5d6a7' }}>
                            <th style={thStyle}>Mascota</th>
                            <th style={thStyle}>Especie</th>
                            <th style={thStyle}>Dueño</th>
                            <th style={thStyle}>Última vacuna</th>
                            <th style={thStyle}>Días</th>
                            <th style={thStyle}>Prioridad</th>
                        </tr>
                    </thead>
                    <tbody>
                        {datos.map((m, i) => (
                            <tr key={i} style={{ background: m.prioridad === 'NUNCA_VACUNADA' ? '#fff9c4' : '#fff' }}>
                                <td style={tdStyle}>{m.nombre}</td>
                                <td style={tdStyle}>{m.especie}</td>
                                <td style={tdStyle}>{m.nombre_dueno}</td>
                                <td style={tdStyle}>{m.fecha_ultima_vacuna || '—'}</td>
                                <td style={tdStyle}>{m.dias_desde_ultima_vacuna ?? '—'}</td>
                                <td style={tdStyle}>
                                    <span style={{
                                        background: m.prioridad === 'NUNCA_VACUNADA' ? '#f57f17' : '#c62828',
                                        color: 'white', padding: '2px 8px', borderRadius: 12, fontSize: 12
                                    }}>
                                        {m.prioridad}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

// Estilos reutilizables
const btnStyle = {
    background: '#1565c0', color: 'white',
    border: 'none', padding: '8px 16px',
    borderRadius: 6, cursor: 'pointer', fontSize: 14
};
const thStyle = { padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #ccc' };
const tdStyle = { padding: '6px 12px', borderBottom: '1px solid #eee' };
