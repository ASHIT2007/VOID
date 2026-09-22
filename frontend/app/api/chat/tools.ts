export const tools = [
  {
    type: "function",
    function: {
      name: "execute_python",
      description: "Executes Python 3 code in a secure sandboxed environment. Use this to perform calculations, data analysis, or algorithmic tasks.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The Python code to execute. Print the final result to stdout.",
          },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Gets the current weather for a specific location.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The city and country to get the weather for, e.g. 'Paris, France'.",
          },
        },
        required: ["location"],
      },
    },
  }
];

export async function executeTool(name: string, args: any) {
  try {
    if (name === "execute_python") {
      const fs = require('fs');
      const path = require('path');
      const { exec } = require('child_process');
      const os = require('os');
      
      const tmpPath = path.join(os.tmpdir(), `execute_${Date.now()}.py`);
      fs.writeFileSync(tmpPath, args.code);
      
      return new Promise((resolve) => {
        exec(`python "${tmpPath}"`, { timeout: 5000 }, (error: any, stdout: any, stderr: any) => {
          try { fs.unlinkSync(tmpPath); } catch (e) {}
          if (error) {
            resolve(`Error: ${error.message}\nStderr: ${stderr}`);
          } else {
            resolve(stdout || "Execution finished with no output.");
          }
        });
      });
    }
    
    if (name === "get_weather") {
      // First geocode the location
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args.location)}&count=1`);
      const geoData = await geoRes.json();
      if (!geoData.results || geoData.results.length === 0) return "Location not found.";
      
      const { latitude, longitude, name: cityName } = geoData.results[0];
      
      // Get weather
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
      const weatherData = await weatherRes.json();
      
      return `Current weather in ${cityName}: ${weatherData.current_weather.temperature}°C, Wind speed: ${weatherData.current_weather.windspeed} km/h`;
    }
    
    return `Unknown tool: ${name}`;
  } catch (error: any) {
    return `Error executing tool ${name}: ${error.message}`;
  }
}
