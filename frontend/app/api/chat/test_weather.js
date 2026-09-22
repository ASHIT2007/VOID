const { executeTool } = require('./tools');

async function testWeather() {
  const output = await executeTool('get_weather', { location: 'Paris, France' });
  console.log("Weather Output:", output);
}

testWeather();
