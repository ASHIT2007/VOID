import json
import re
import uuid
from openai import OpenAI
from rich.console import Console
from config import API_BASE_URL, API_KEY, MODEL_NAME, WORKSPACE_PATH
from tools import TOOLS_SCHEMA, AVAILABLE_FUNCTIONS

console = Console()

# Initialize OpenAI client pointed to local API
client = OpenAI(
    base_url=API_BASE_URL,
    api_key=API_KEY
)

SYSTEM_PROMPT = f"""You are VOID-X, a powerful personal desktop AI agent running on the user's Windows computer.
Your primary goal is to assist the user with coding, system management, web research, and daily tasks.

Workspace Context:
The user is currently working on a project located at: {WORKSPACE_PATH}
You can read files, write code, and run commands inside this directory.

Available Tools (12):
1.  run_terminal_command(command) — Execute a shell command. User must confirm.
2.  read_file(filepath) — Read a file's contents.
3.  write_file(filepath, content) — Create or overwrite a file.
4.  search_web(query) — Search the internet for information.
5.  system_info() — Get OS, CPU, RAM, disk, battery, and top processes.
6.  find_files(search_path, pattern) — Search for files matching a glob pattern.
7.  open_url(url) — Open a URL in the default browser.
8.  read_webpage(url) — Fetch and extract readable text from a webpage.
9.  notes(action, title, content) — Manage persistent notes (add/list/view/delete).
10. generate_image(prompt, filename) — Generate an AI image from a text description.
11. send_email(to, subject, body) — Send an email.
12. plot_chart(chart_type, title, labels, values) — Create a chart.
13. weather_fetch(location) — Get current weather.
14. currency_convert(amount, from_currency, to_currency) — Convert currencies.
15. stock_quote(symbol) — Get stock prices.
16. calculator(expression) — Evaluate math.

Guidelines:
- Be concise and helpful.
- Use Windows (PowerShell/CMD) syntax for commands.
- Do not make up file paths. Explore the directory first if needed.
- When you need to use a tool, call it directly. Do not output conversational text mixed with tool calls.
- Only call ONE tool at a time.
- If the user denies a command, do NOT retry with another command. Just explain what you were trying to do.
- CRITICAL: If asked about your identity, who you are, or what models you use, you MUST explicitly say: "I am Void. I use Groq Whisper for my hearing, and ElevenLabs for my voice." DO NOT mention OpenAI, GPT, or any other company.
"""

MAX_TOOL_CALLS = 15  # Safety guard: max tool calls per user message


class DesktopAgent:
    def __init__(self):
        self.messages = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]

    def _call_api(self, use_tools=True):
        """Call the API with automatic Groq 400 fallback."""
        try:
            kwargs = {
                "model": MODEL_NAME,
                "messages": self.messages,
            }
            if use_tools:
                kwargs["tools"] = TOOLS_SCHEMA
                kwargs["tool_choice"] = "auto"
            return client.chat.completions.create(**kwargs)
        except Exception as e:
            error_msg = str(e)
            # Groq strict tool-calling 400 crash: retry without native tools
            if "400" in error_msg and ("Failed to call a function" in error_msg or "model_not_found" in error_msg):
                fallback_msg = (
                    "You must output your tool call as raw text in exactly this format: "
                    '<function/tool_name>{"arg1": "value1"}\n'
                    "Available tools: " + ", ".join(AVAILABLE_FUNCTIONS.keys())
                )
                temp_messages = self.messages + [{"role": "system", "content": fallback_msg}]
                return client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=temp_messages
                )
            else:
                raise

    def _parse_raw_tool_call(self, content):
        """Parse raw text tool calls from models that don't support native function calling."""
        if not content:
            return None

        # Build a regex that matches any known function name followed by JSON
        func_names = list(AVAILABLE_FUNCTIONS.keys())
        # Match: <function/name>{...}, <function(name)>{...}, or just name{...}
        pattern = r'(?:<function[/\(])?' + '(' + '|'.join(re.escape(n) for n in func_names) + r')' + r'[>\)]?\s*(\{.*)'
        match = re.search(pattern, content, re.DOTALL)
        if not match:
            return None

        func_name = match.group(1).strip()
        raw_args = match.group(2).strip()

        # Brace-matching to extract just the JSON payload
        brace_count = 0
        end_idx = -1
        in_string = False
        escape_next = False
        for i, char in enumerate(raw_args):
            if escape_next:
                escape_next = False
                continue
            if char == '\\':
                escape_next = True
                continue
            if char == '"' and not escape_next:
                in_string = not in_string
                continue
            if in_string:
                continue
            if char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                if brace_count == 0:
                    end_idx = i
                    break

        if end_idx != -1:
            func_args_str = raw_args[:end_idx + 1]
        else:
            func_args_str = raw_args

        # Validate it's actually parseable JSON
        try:
            json.loads(func_args_str)
        except json.JSONDecodeError:
            return None

        class MockFunction:
            def __init__(self, name, arguments):
                self.name = name
                self.arguments = arguments

        class MockToolCall:
            def __init__(self, id, function):
                self.id = id
                self.function = function

        tool_call = MockToolCall(
            id=f"call_{uuid.uuid4().hex[:8]}",
            function=MockFunction(name=func_name, arguments=func_args_str)
        )

        # Strip the raw tool call text from visible content
        clean_content = content.replace(match.group(0), "").strip()

        return {
            "tool_call": tool_call,
            "clean_content": clean_content if clean_content else None
        }

    def process_user_input(self, user_input: str, status=None):
        self.messages.append({"role": "user", "content": user_input})
        tool_call_count = 0

        while True:
            try:
                # Guard against infinite tool-call loops
                use_tools = tool_call_count < MAX_TOOL_CALLS
                response = self._call_api(use_tools=use_tools)

                response_message = response.choices[0].message

                # Try to parse raw text tool calls if native ones aren't present
                if not response_message.tool_calls and response_message.content:
                    parsed = self._parse_raw_tool_call(response_message.content)
                    if parsed:
                        response_message.tool_calls = [parsed["tool_call"]]
                        response_message.content = parsed["clean_content"]

                # Build message dict for conversation history
                message_to_append = {"role": "assistant"}
                if response_message.content:
                    message_to_append["content"] = response_message.content
                if response_message.tool_calls:
                    message_to_append["tool_calls"] = [
                        {
                            "id": tool.id,
                            "type": "function",
                            "function": {
                                "name": tool.function.name,
                                "arguments": tool.function.arguments
                            }
                        } for tool in response_message.tool_calls
                    ]
                self.messages.append(message_to_append)

                # Execute tool calls if present
                if response_message.tool_calls:
                    for tool_call in response_message.tool_calls:
                        function_name = tool_call.function.name
                        function_to_call = AVAILABLE_FUNCTIONS.get(function_name)

                        if function_to_call:
                            try:
                                function_args = json.loads(tool_call.function.arguments)
                            except json.JSONDecodeError:
                                self.messages.append({
                                    "tool_call_id": tool_call.id,
                                    "role": "tool",
                                    "name": function_name,
                                    "content": "Error: Could not parse tool arguments.",
                                })
                                continue

                            # Update status spinner
                            if status:
                                action_map = {
                                    "search_web": "🔍 Searching the web",
                                    "run_terminal_command": "⚡ Executing command",
                                    "read_file": "📄 Reading file",
                                    "write_file": "✏️ Writing to file",
                                    "system_info": "🖥️ Gathering system info",
                                    "find_files": "🔎 Searching for files",
                                    "open_url": "🌐 Opening URL",
                                    "read_webpage": "📰 Fetching webpage",
                                    "notes": "📝 Managing notes",
                                    "generate_image": "🎨 Generating image",
                                    "send_email": "📧 Preparing email",
                                    "plot_chart": "📊 Creating chart",
                                }
                                action_text = action_map.get(function_name, f"Running {function_name}")
                                status.update(f"[bold blue]{action_text}...")

                            # Pause spinner for interactive tools (needs user input)
                            needs_input = function_name in ("run_terminal_command", "send_email")
                            if status and needs_input:
                                status.stop()

                            function_response = function_to_call(**function_args)

                            # Resume spinner
                            if status and needs_input:
                                status.start()

                            if status:
                                status.update("[bold blue]Agent is analyzing results...")

                            self.messages.append({
                                "tool_call_id": tool_call.id,
                                "role": "tool",
                                "name": function_name,
                                "content": str(function_response),
                            })
                        else:
                            self.messages.append({
                                "tool_call_id": tool_call.id,
                                "role": "tool",
                                "name": function_name,
                                "content": f"Error: Unknown tool '{function_name}'.",
                            })

                    tool_call_count += 1
                    continue  # Loop back for the model's next response
                else:
                    # No tool call — return the text response
                    return response_message.content or "*(No response from the model)*"

            except Exception as e:
                error_msg = str(e)
                console.print(f"[bold red]API Error:[/bold red] {error_msg}")
                return "I encountered an error. Please check that freellmapi is running and config.py is correct."
