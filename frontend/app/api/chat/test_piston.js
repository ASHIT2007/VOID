const { executeTool } = require('./tools');

async function test() {
  const output = await executeTool('execute_python', { code: 'print("Hello from Piston!")' });
  console.log("Piston Output:", output);
}

test();
