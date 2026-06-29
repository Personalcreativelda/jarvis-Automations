import { useEffect, useState } from "react";
import { MapPin, Wind, Droplets, Eye, Thermometer } from "lucide-react";

const WMO_CODES: Record<number, { label: string; icon: string }> = {
  0:  { label: "Céu limpo",       icon: "☀️" },
  1:  { label: "Maioria limpo",   icon: "🌤" },
  2:  { label: "Parcialmente nublado", icon: "⛅" },
  3:  { label: "Nublado",         icon: "☁️" },
  45: { label: "Nevoeiro",        icon: "🌫" },
  48: { label: "Nevoeiro com gelo", icon: "🌫" },
  51: { label: "Chuvisco leve",   icon: "🌦" },
  53: { label: "Chuvisco moderado", icon: "🌦" },
  55: { label: "Chuvisco denso",  icon: "🌧" },
  61: { label: "Chuva leve",      icon: "🌧" },
  63: { label: "Chuva moderada",  icon: "🌧" },
  65: { label: "Chuva forte",     icon: "🌧" },
  71: { label: "Neve leve",       icon: "🌨" },
  73: { label: "Neve moderada",   icon: "❄️" },
  75: { label: "Neve forte",      icon: "❄️" },
  80: { label: "Aguaceiros leves", icon: "🌦" },
  81: { label: "Aguaceiros",      icon: "🌧" },
  82: { label: "Aguaceiros fortes", icon: "⛈" },
  95: { label: "Trovoada",        icon: "⛈" },
  96: { label: "Trovoada c/ granizo", icon: "⛈" },
  99: { label: "Trovoada forte",  icon: "⛈" },
};

interface WeatherData {
  city: string;
  temp: number;
  feels: number;
  humidity: number;
  windSpeed: number;
  visibility: number;
  code: number;
  high: number;
  low: number;
  forecast: { day: string; code: number; high: number; low: number }[];
}

function getDayLabel(offset: number): string {
  if (offset === 0) return "HOJE";
  if (offset === 1) return "AMANHÃ";
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("pt-PT", { weekday: "short" }).toUpperCase();
}

export function WeatherCard() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cached = sessionStorage.getItem("jarvis_weather");
    const cachedAt = Number(sessionStorage.getItem("jarvis_weather_ts") || "0");
    if (cached && Date.now() - cachedAt < 10 * 60 * 1000) {
      setData(JSON.parse(cached));
      return;
    }
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
      );
      const { latitude: lat, longitude: lon } = pos.coords;

      // Reverse geocoding — Open-Meteo não tem, usar nominatim
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
        { headers: { "Accept-Language": "pt" } }
      );
      const geoJson = await geoRes.json();
      const city =
        geoJson?.address?.city ||
        geoJson?.address?.town ||
        geoJson?.address?.village ||
        geoJson?.address?.county ||
        "Localização";

      // Clima — Open-Meteo (gratuito, sem chave)
      const wx = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code` +
          `&hourly=visibility` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
          `&timezone=auto&forecast_days=5`
      );
      const wxJson = await wx.json();
      if (wxJson.error) throw new Error(wxJson.reason || "Open-Meteo error");
      const cur = wxJson.current;
      const daily = wxJson.daily;

      // Pega visibilidade da hora atual (hourly[0])
      const visibilityM: number = wxJson.hourly?.visibility?.[0] ?? 10000;

      const weather: WeatherData = {
        city,
        temp: Math.round(cur.temperature_2m),
        feels: Math.round(cur.apparent_temperature),
        humidity: cur.relative_humidity_2m,
        windSpeed: Math.round(cur.wind_speed_10m),
        visibility: Math.round(visibilityM / 1000),
        code: cur.weather_code,
        high: Math.round(daily.temperature_2m_max[0]),
        low: Math.round(daily.temperature_2m_min[0]),
        forecast: daily.time.slice(0, 5).map((t: string, i: number) => ({
          day: getDayLabel(i),
          code: daily.weather_code[i],
          high: Math.round(daily.temperature_2m_max[i]),
          low: Math.round(daily.temperature_2m_min[i]),
        })),
      };

      sessionStorage.setItem("jarvis_weather", JSON.stringify(weather));
      sessionStorage.setItem("jarvis_weather_ts", String(Date.now()));
      setData(weather);
    } catch (e: any) {
      if (e?.code === 1) setError("Permissão de localização negada.");
      else setError("Erro ao obter dados meteorológicos.");
    } finally {
      setLoading(false);
    }
  }

  const wx = data ? (WMO_CODES[data.code] ?? { label: "Desconhecido", icon: "🌡" }) : null;

  return (
    <div className="bg-black/50 border border-cyan-400/15 rounded-lg p-4 backdrop-blur-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-400/50">
          // ATMOSFERA
        </div>
        {data && (
          <button onClick={load} className="text-[9px] text-cyan-400/30 hover:text-cyan-400/70 transition uppercase tracking-wider">
            ↻ ATUALIZAR
          </button>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center py-4 gap-2">
          <div className="w-5 h-5 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
          <span className="text-[8px] text-cyan-400/40 uppercase tracking-widest">
            A OBTER DADOS...
          </span>
        </div>
      )}

      {error && !loading && (
        <div className="space-y-2">
          <p className="text-[9px] text-red-400/70">{error}</p>
          <button
            onClick={load}
            className="text-[8px] text-cyan-300/60 hover:text-cyan-300 underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && !data && (
        <button
          onClick={load}
          className="w-full text-[9px] uppercase tracking-widest text-cyan-400/50 hover:text-cyan-300 transition py-3 border border-cyan-400/10 rounded"
        >
          📍 OBTER LOCALIZAÇÃO
        </button>
      )}

      {data && !loading && (
        <>
          {/* Cidade + condição principal */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-1 text-[10px] text-cyan-400/50">
                <MapPin className="h-3 w-3" />
                <span className="uppercase tracking-widest truncate max-w-[130px]">{data.city}</span>
              </div>
              <div className="text-4xl font-mono font-bold text-cyan-300 leading-tight mt-0.5">
                {data.temp}°<span className="text-lg font-normal text-cyan-400/60">C</span>
              </div>
              <div className="text-xs text-cyan-400/50 mt-0.5">{wx?.label}</div>
            </div>
            <div className="text-4xl leading-none">{wx?.icon}</div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { icon: <Thermometer className="h-2.5 w-2.5" />, label: "SENSAÇÃO", value: `${data.feels}°C` },
              { icon: <Droplets className="h-2.5 w-2.5" />, label: "HUMIDADE", value: `${data.humidity}%` },
              { icon: <Wind className="h-2.5 w-2.5" />, label: "VENTO", value: `${data.windSpeed} km/h` },
              { icon: <Eye className="h-2.5 w-2.5" />, label: "VISIB.", value: `${data.visibility} km` },
            ].map((s) => (
              <div key={s.label} className="bg-black/40 rounded p-2 flex items-center gap-2">
                <span className="text-cyan-400/40">{s.icon}</span>
                <div>
                  <div className="text-[9px] text-cyan-400/30 uppercase tracking-wider">{s.label}</div>
                  <div className="text-xs font-mono text-cyan-300">{s.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* High / low */}
          <div className="flex justify-between text-xs font-mono px-1">
            <span className="text-cyan-400/40">
              ↑ <span className="text-orange-300/80">{data.high}°</span>
            </span>
            <span className="text-cyan-400/40">
              ↓ <span className="text-blue-300/80">{data.low}°</span>
            </span>
          </div>

          {/* Separador */}
          <div className="border-t border-cyan-400/10" />

          {/* Previsão 5 dias */}
          <div className="grid grid-cols-5 gap-0.5">
            {data.forecast.map((f) => {
              const fw = WMO_CODES[f.code] ?? { icon: "🌡" };
              return (
                <div key={f.day} className="flex flex-col items-center gap-0.5 bg-black/30 rounded py-1.5">
                  <span className="text-[9px] text-cyan-400/40 uppercase">{f.day}</span>
                  <span className="text-xl leading-none">{fw.icon}</span>
                  <span className="text-[10px] font-mono text-orange-300/70">{f.high}°</span>
                  <span className="text-[10px] font-mono text-blue-300/60">{f.low}°</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
