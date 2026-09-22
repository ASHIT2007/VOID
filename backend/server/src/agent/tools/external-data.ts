import { registerTool, ToolHandler, ToolResult } from '../tool-registry.js';

export function registerExternalDataTools(): void {
  const weatherHandler: ToolHandler = async (args) => {
    const location = args.location as string;
    if (!location) return { content: '', error: 'location is required' };

    try {
      const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`, {
        headers: { 'User-Agent': 'VOID-Agent/1.0 (contact@void.app)' }
      });
      const geoData: any = await geoRes.json();
      if (!geoData || geoData.length === 0) return { content: '', error: 'Location not found' };

      const { lat, lon } = geoData[0];
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3`);
      const weatherData: any = await weatherRes.json();

      const mapCode = (code: number) => {
        if (code === 0) return 'Clear';
        if (code <= 3) return 'Partly cloudy/Overcast';
        if (code <= 48) return 'Fog';
        if (code <= 55) return 'Drizzle';
        if (code <= 65) return 'Rain';
        if (code <= 75) return 'Snow';
        if (code <= 82) return 'Showers';
        if (code <= 99) return 'Thunderstorm';
        return 'Unknown';
      };

      const current = weatherData.current;
      let output = `Current Weather in ${location}:\nTemperature: ${current.temperature_2m}°C\nHumidity: ${current.relative_humidity_2m}%\nWind Speed: ${current.wind_speed_10m} km/h\nConditions: ${mapCode(current.weather_code)}\n\nForecast:\n`;
      
      const daily = weatherData.daily;
      for (let i = 0; i < daily.time.length; i++) {
        output += `${daily.time[i]}: Max ${daily.temperature_2m_max[i]}°C, Min ${daily.temperature_2m_min[i]}°C, ${mapCode(daily.weather_code[i])}\n`;
      }

      return { content: output };
    } catch (err: any) {
      return { content: '', error: `Weather fetch failed: ${err.message}` };
    }
  };

  const currencyHandler: ToolHandler = async (args) => {
    const amount = args.amount as number;
    const from = (args.from as string).toUpperCase();
    const to = (args.to as string).toUpperCase();
    if (!amount || !from || !to) return { content: '', error: 'amount, from, and to are required' };

    try {
      const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`);
      const data: any = await res.json();
      if (!data || !data.rates || !data.rates[to]) return { content: '', error: 'Currency not found or conversion rate unavailable' };
      
      const rate = data.rates[to];
      const result = amount * rate;
      return { content: `${amount} ${from} = ${result.toFixed(2)} ${to} (Rate: ${rate}, Updated: ${data.date})` };
    } catch (err: any) {
      return { content: '', error: `Currency conversion failed: ${err.message}` };
    }
  };

  const stockHandler: ToolHandler = async (args) => {
    const symbol = args.symbol as string;
    if (!symbol) return { content: '', error: 'symbol is required' };

    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`);
      const data: any = await res.json();
      
      if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
        return { content: '', error: `Failed to retrieve data for ${symbol}. The symbol might be wrong or delisted.` };
      }

      const result = data.chart.result[0];
      const meta = result.meta;
      const currentPrice = meta.regularMarketPrice;
      const previousClose = meta.chartPreviousClose;
      const change = currentPrice - previousClose;
      const changePercent = (change / previousClose) * 100;
      const volumes = result.indicators.quote[0].volume;
      const volume = volumes ? volumes[volumes.length - 1] : 'N/A';

      return { content: `${symbol}:\nCurrent Price: ${currentPrice}\nPrevious Close: ${previousClose}\nChange: ${change.toFixed(2)} (${changePercent.toFixed(2)}%)\nVolume: ${volume}` };
    } catch (err: any) {
      return { content: '', error: `Stock quote fetch failed: ${err.message}. The symbol might be wrong.` };
    }
  };

  registerTool('weather_fetch', { type: 'function', function: { name: 'weather_fetch', parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] } } }, weatherHandler, { requiresConfirmation: false, readOnly: true, category: 'data' });
  registerTool('currency_convert', { type: 'function', function: { name: 'currency_convert', parameters: { type: 'object', properties: { amount: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['amount', 'from', 'to'] } } }, currencyHandler, { requiresConfirmation: false, readOnly: true, category: 'data' });
  registerTool('stock_quote', { type: 'function', function: { name: 'stock_quote', parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } } }, stockHandler, { requiresConfirmation: false, readOnly: true, category: 'data' });
}
