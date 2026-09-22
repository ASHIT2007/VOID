import os
import sys
import json
import subprocess
import platform
import webbrowser
import smtplib
import urllib.parse
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import psutil
import requests
from bs4 import BeautifulSoup
from ddgs import DDGS
from rich.prompt import Confirm
from rich.console import Console

console = Console()

# ─── Paths ───────────────────────────────────────────────────────────────────
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
NOTES_FILE = os.path.join(AGENT_DIR, "notes.json")
CHARTS_DIR = os.path.join(AGENT_DIR, "charts")
IMAGES_DIR = os.path.join(AGENT_DIR, "generated_images")


# ═══════════════════════════════════════════════════════════════════════════════
#  ORIGINAL TOOLS
# ═══════════════════════════════════════════════════════════════════════════════

def run_terminal_command(command: str) -> str:
    """Executes a terminal command safely after asking for user confirmation."""
    console.print(f"\n[bold yellow]Agent wants to run command:[/bold yellow] [cyan]{command}[/cyan]")
    is_safe = Confirm.ask("Do you want to execute this command?", default=False)

    if not is_safe:
        return "User denied execution of the command."

    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=60)
        output = result.stdout
        if result.stderr:
            output += f"\nError Output:\n{result.stderr}"
        return output if output.strip() else "Command executed successfully with no output."
    except subprocess.TimeoutExpired:
        return "Error: Command timed out after 60 seconds."
    except Exception as e:
        return f"Error executing command: {str(e)}"


def read_file(filepath: str) -> str:
    """Reads the contents of a specified file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"


def write_file(filepath: str, content: str) -> str:
    """Creates or updates a file with the specified content."""
    try:
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return f"Successfully wrote to {filepath}"
    except Exception as e:
        return f"Error writing file: {str(e)}"


def search_web(query: str) -> str:
    """Performs a live web search and returns summaries."""
    try:
        results = DDGS().text(query, max_results=5)

        if not results:
            return "No results found."

        output = []
        for i, r in enumerate(results, 1):
            title = r.get('title', 'No title')
            url = r.get('href', '')
            body = r.get('body', 'No summary available.')
            output.append(f"[{i}] {title}\n    URL: {url}\n    {body}")
        return "\n\n".join(output)
    except Exception as e:
        return f"Error searching web: {str(e)}"


# ═══════════════════════════════════════════════════════════════════════════════
#  NEW TOOLS
# ═══════════════════════════════════════════════════════════════════════════════

# ─── 1. System Info ──────────────────────────────────────────────────────────

def system_info() -> str:
    """Returns detailed system information."""
    try:
        uname = platform.uname()
        cpu_freq = psutil.cpu_freq()
        ram = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        net = psutil.net_if_addrs()
        boot = datetime.fromtimestamp(psutil.boot_time())

        info = []
        info.append("── SYSTEM ──")
        info.append(f"  OS:         {uname.system} {uname.release} ({uname.version})")
        info.append(f"  Machine:    {uname.node} ({uname.machine})")
        info.append(f"  Processor:  {uname.processor}")
        info.append(f"  Boot Time:  {boot.strftime('%Y-%m-%d %H:%M:%S')}")

        info.append("\n── CPU ──")
        info.append(f"  Cores:      {psutil.cpu_count(logical=False)} physical, {psutil.cpu_count(logical=True)} logical")
        if cpu_freq:
            info.append(f"  Frequency:  {cpu_freq.current:.0f} MHz")
        info.append(f"  Usage:      {psutil.cpu_percent(interval=1)}%")

        info.append("\n── MEMORY ──")
        info.append(f"  Total:      {ram.total / (1024**3):.1f} GB")
        info.append(f"  Used:       {ram.used / (1024**3):.1f} GB ({ram.percent}%)")
        info.append(f"  Available:  {ram.available / (1024**3):.1f} GB")

        info.append("\n── DISK (C:) ──")
        info.append(f"  Total:      {disk.total / (1024**3):.1f} GB")
        info.append(f"  Used:       {disk.used / (1024**3):.1f} GB ({disk.percent}%)")
        info.append(f"  Free:       {disk.free / (1024**3):.1f} GB")

        # Battery (laptops only)
        battery = psutil.sensors_battery()
        if battery:
            info.append("\n── BATTERY ──")
            info.append(f"  Charge:     {battery.percent}%")
            info.append(f"  Plugged In: {'Yes' if battery.power_plugged else 'No'}")
            if battery.secsleft > 0 and not battery.power_plugged:
                mins = battery.secsleft // 60
                info.append(f"  Time Left:  {mins // 60}h {mins % 60}m")

        # Top 5 processes by memory
        info.append("\n── TOP PROCESSES (by RAM) ──")
        procs = []
        for p in psutil.process_iter(['pid', 'name', 'memory_percent']):
            try:
                procs.append(p.info)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        procs.sort(key=lambda x: x.get('memory_percent', 0) or 0, reverse=True)
        for p in procs[:5]:
            info.append(f"  {p['name']:<30} PID: {p['pid']:<8} RAM: {p.get('memory_percent', 0):.1f}%")

        return "\n".join(info)
    except Exception as e:
        return f"Error getting system info: {str(e)}"


# ─── 2. Find Files ──────────────────────────────────────────────────────────

def find_files(search_path: str, pattern: str) -> str:
    """Searches for files matching a pattern recursively."""
    try:
        import glob
        if not os.path.isdir(search_path):
            return f"Error: '{search_path}' is not a valid directory."

        search_pattern = os.path.join(search_path, '**', pattern)
        matches = glob.glob(search_pattern, recursive=True)

        if not matches:
            return f"No files matching '{pattern}' found in {search_path}"

        # Limit results
        total = len(matches)
        matches = matches[:30]

        output = [f"Found {total} file(s) matching '{pattern}' in {search_path}:\n"]
        for i, path in enumerate(matches, 1):
            try:
                size = os.path.getsize(path)
                if size < 1024:
                    size_str = f"{size} B"
                elif size < 1024 * 1024:
                    size_str = f"{size / 1024:.1f} KB"
                else:
                    size_str = f"{size / (1024 * 1024):.1f} MB"
                output.append(f"  [{i}] {path}  ({size_str})")
            except OSError:
                output.append(f"  [{i}] {path}")

        if total > 30:
            output.append(f"\n  ... and {total - 30} more results.")
        return "\n".join(output)
    except Exception as e:
        return f"Error finding files: {str(e)}"


# ─── 3. Open URL ─────────────────────────────────────────────────────────────

def open_url(url: str) -> str:
    """Opens a URL in the user's default web browser."""
    try:
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url
        webbrowser.open(url)
        return f"Opened {url} in default browser."
    except Exception as e:
        return f"Error opening URL: {str(e)}"


# ─── 4. Read Webpage ─────────────────────────────────────────────────────────

def read_webpage(url: str) -> str:
    """Fetches a webpage and extracts its text content."""
    try:
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Remove non-content elements
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'form', 'iframe']):
            tag.decompose()

        # Extract text
        text = soup.get_text(separator='\n', strip=True)

        # Clean up excessive blank lines
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        text = '\n'.join(lines)

        # Get page title
        title = soup.title.string.strip() if soup.title and soup.title.string else "No title"

        # Limit output
        if len(text) > 4000:
            text = text[:4000] + "\n\n... [Content truncated — page was too long]"

        return f"Page Title: {title}\nURL: {url}\n{'─' * 50}\n{text}"
    except requests.exceptions.Timeout:
        return f"Error: Request to {url} timed out after 15 seconds."
    except requests.exceptions.HTTPError as e:
        return f"Error: HTTP {e.response.status_code} when fetching {url}"
    except Exception as e:
        return f"Error reading webpage: {str(e)}"


# ─── 5. Notes ─────────────────────────────────────────────────────────────────

def notes(action: str, title: str = "", content: str = "") -> str:
    """Manage persistent notes. Actions: add, list, view, delete."""
    try:
        # Load existing notes
        if os.path.exists(NOTES_FILE):
            with open(NOTES_FILE, 'r', encoding='utf-8') as f:
                all_notes = json.load(f)
        else:
            all_notes = []

        action = action.lower().strip()

        if action == "add":
            if not title:
                return "Error: Please provide a title for the note."
            note = {
                "id": len(all_notes) + 1,
                "title": title,
                "content": content,
                "created": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            all_notes.append(note)
            with open(NOTES_FILE, 'w', encoding='utf-8') as f:
                json.dump(all_notes, f, indent=2, ensure_ascii=False)
            return f"Note #{note['id']} '{title}' saved successfully."

        elif action == "list":
            if not all_notes:
                return "No notes found. Use action 'add' to create one."
            output = [f"You have {len(all_notes)} note(s):\n"]
            for n in all_notes:
                preview = n['content'][:60] + "..." if len(n['content']) > 60 else n['content']
                output.append(f"  #{n['id']} | {n['title']}  ({n['created']})\n       {preview}")
            return "\n".join(output)

        elif action == "view":
            if not title:
                return "Error: Provide the note title or ID to view."
            for n in all_notes:
                if str(n['id']) == str(title) or n['title'].lower() == title.lower():
                    return f"── Note #{n['id']}: {n['title']} ──\nCreated: {n['created']}\n\n{n['content']}"
            return f"Note '{title}' not found."

        elif action == "delete":
            if not title:
                return "Error: Provide the note title or ID to delete."
            for i, n in enumerate(all_notes):
                if str(n['id']) == str(title) or n['title'].lower() == title.lower():
                    removed = all_notes.pop(i)
                    with open(NOTES_FILE, 'w', encoding='utf-8') as f:
                        json.dump(all_notes, f, indent=2, ensure_ascii=False)
                    return f"Note #{removed['id']} '{removed['title']}' deleted."
            return f"Note '{title}' not found."

        else:
            return f"Unknown action '{action}'. Valid actions: add, list, view, delete."

    except Exception as e:
        return f"Error managing notes: {str(e)}"


# ─── 6. Generate Image ───────────────────────────────────────────────────────

# Provider keys are local environment configuration, never source constants.
_IMG_KEYS = {
    name: os.getenv(name, "")
    for name in ("POLLINATIONS_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "GEMINI_API_KEY")
}


def _enhance_prompt(prompt: str, model_style: str = "FLUX") -> str:
    """Uses Groq to enhance the image prompt (same as web app)."""
    try:
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {_IMG_KEYS['GROQ_API_KEY']}"
            },
            json={
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are an expert Midjourney/FLUX prompt engineer. "
                            "The user will give you a brief prompt. Expand it into a highly detailed, "
                            "cinematic, comma-separated image generation prompt. "
                            "Fix any typos. Output ONLY the raw prompt, no intro, no quotes."
                        )
                    },
                    {"role": "user", "content": f'Original prompt: "{prompt}"\nTarget Model Style: {model_style}'}
                ],
                "temperature": 0.7,
                "max_tokens": 150,
            },
            timeout=15
        )
        if r.status_code == 200:
            enhanced = r.json()['choices'][0]['message']['content'].strip()
            if enhanced:
                return enhanced
    except Exception:
        pass
    return prompt


def generate_image(prompt: str, filename: str = "") -> str:
    """Generates an AI image using Pollinations.ai with API key (same as VOID web app)."""
    try:
        import random

        os.makedirs(IMAGES_DIR, exist_ok=True)

        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"img_{timestamp}.png"
        if not filename.endswith('.png'):
            filename += '.png'

        save_path = os.path.join(IMAGES_DIR, filename)

        console.print(f"[dim]Generating image: \"{prompt}\"...[/dim]")

        # Step 1: Enhance the prompt with Groq (same as web app)
        console.print("[dim]  Enhancing prompt with AI...[/dim]")
        enhanced_prompt = _enhance_prompt(prompt)
        if enhanced_prompt != prompt:
            console.print(f"[dim]  Enhanced: \"{enhanced_prompt[:80]}...\"[/dim]")

        # Step 2: Generate via Pollinations.ai with API key (using authenticated endpoint)
        seed = random.randint(0, 999999)
        encoded = urllib.parse.quote(enhanced_prompt)
        poll_url = f"https://gen.pollinations.ai/image/{encoded}?model=flux&width=1024&height=1024&nologo=true&seed={seed}"

        retries = 2
        response = None
        while retries >= 0:
            try:
                console.print(f"[dim]  Requesting image from Pollinations.ai (attempt {3-retries}/3)...[/dim]")
                response = requests.get(
                    poll_url,
                    timeout=90,
                    headers={
                        "Authorization": f"Bearer {_IMG_KEYS['POLLINATIONS_API_KEY']}",
                    }
                )
                ct = response.headers.get("content-type", "")
                if response.status_code == 200 and ("image" in ct or len(response.content) > 5000):
                    break
                else:
                    response = None
            except Exception:
                response = None
            retries -= 1
            if retries >= 0:
                import time
                time.sleep(2)

        if response and response.status_code == 200 and len(response.content) > 5000:
            with open(save_path, 'wb') as f:
                f.write(response.content)

            # Auto-open the image
            os.startfile(save_path)

            return (
                f"Image generated and saved to: {save_path}\n"
                f"Prompt: {prompt}\n"
                f"Enhanced: {enhanced_prompt[:100]}\n"
                f"Size: {len(response.content) / 1024:.1f} KB"
            )
        else:
            return (
                f"Image generation failed — Pollinations.ai returned an error.\n"
                f"This usually means the service is temporarily overloaded.\n"
                f"Try again in a minute, or ask me to open an image generator website."
            )

    except Exception as e:
        return f"Error generating image: {str(e)}"


# ─── 7. Send Email ───────────────────────────────────────────────────────────

def send_email(to: str, subject: str, body: str) -> str:
    """Sends an email via Gmail SMTP. Requires email_config.json with credentials."""
    try:
        config_path = os.path.join(AGENT_DIR, "email_config.json")

        if not os.path.exists(config_path):
            # Create a template config
            template = {
                "sender_email": "your_email@gmail.com",
                "app_password": "your_gmail_app_password",
                "smtp_server": "smtp.gmail.com",
                "smtp_port": 587
            }
            with open(config_path, 'w') as f:
                json.dump(template, f, indent=2)
            return (
                f"Email config not found. I've created a template at:\n"
                f"  {config_path}\n\n"
                f"Please edit it with your Gmail address and App Password.\n"
                f"To get an App Password: Google Account > Security > 2-Step Verification > App Passwords.\n"
                f"Then try sending the email again."
            )

        with open(config_path, 'r') as f:
            config = json.load(f)

        sender = config.get("sender_email", "")
        password = config.get("app_password", "")
        smtp_server = config.get("smtp_server", "smtp.gmail.com")
        smtp_port = config.get("smtp_port", 587)

        if "your_email" in sender or "your_gmail" in password:
            return f"Please update your email credentials in:\n  {config_path}"

        # Confirm before sending
        console.print(f"\n[bold yellow]Agent wants to send an email:[/bold yellow]")
        console.print(f"  [cyan]To:[/cyan]      {to}")
        console.print(f"  [cyan]Subject:[/cyan] {subject}")
        console.print(f"  [cyan]Body:[/cyan]    {body[:100]}{'...' if len(body) > 100 else ''}")
        confirmed = Confirm.ask("Send this email?", default=False)

        if not confirmed:
            return "User cancelled sending the email."

        msg = MIMEMultipart()
        msg['From'] = sender
        msg['To'] = to
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            server.login(sender, password)
            server.send_message(msg)

        return f"Email sent successfully to {to}!"
    except smtplib.SMTPAuthenticationError:
        return "Error: Gmail authentication failed. Check your email and App Password in email_config.json."
    except Exception as e:
        return f"Error sending email: {str(e)}"


# ─── 8. Plot Chart ───────────────────────────────────────────────────────────

def plot_chart(chart_type: str, title: str, labels: str, values: str, filename: str = "") -> str:
    """Creates a chart and saves it as an image. Labels and values are comma-separated."""
    try:
        import matplotlib
        matplotlib.use('Agg')  # Non-interactive backend
        import matplotlib.pyplot as plt

        os.makedirs(CHARTS_DIR, exist_ok=True)

        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"chart_{timestamp}.png"
        if not filename.endswith('.png'):
            filename += '.png'

        save_path = os.path.join(CHARTS_DIR, filename)

        # Parse data
        label_list = [l.strip() for l in labels.split(',')]
        value_list = [float(v.strip()) for v in values.split(',')]

        if len(label_list) != len(value_list):
            return f"Error: Number of labels ({len(label_list)}) doesn't match number of values ({len(value_list)})."

        # Style
        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(10, 6))
        fig.patch.set_facecolor('#1a1a2e')
        ax.set_facecolor('#16213e')

        colors = ['#e94560', '#0f3460', '#533483', '#e94560', '#00b4d8',
                  '#06d6a0', '#ffd166', '#ef476f', '#118ab2', '#073b4c']

        chart_type = chart_type.lower().strip()

        if chart_type == 'bar':
            bars = ax.bar(label_list, value_list, color=colors[:len(label_list)], edgecolor='white', linewidth=0.5)
            for bar, val in zip(bars, value_list):
                ax.text(bar.get_x() + bar.get_width() / 2., bar.get_height() + max(value_list) * 0.02,
                        f'{val}', ha='center', va='bottom', fontweight='bold', color='white', fontsize=10)

        elif chart_type == 'pie':
            wedges, texts, autotexts = ax.pie(
                value_list, labels=label_list, colors=colors[:len(label_list)],
                autopct='%1.1f%%', startangle=90, textprops={'color': 'white'}
            )
            for t in autotexts:
                t.set_fontweight('bold')

        elif chart_type == 'line':
            ax.plot(label_list, value_list, marker='o', color='#e94560', linewidth=2, markersize=8)
            ax.fill_between(range(len(value_list)), value_list, alpha=0.1, color='#e94560')
            for i, val in enumerate(value_list):
                ax.annotate(f'{val}', (i, val), textcoords="offset points", xytext=(0, 10),
                            ha='center', color='white', fontweight='bold')

        elif chart_type == 'horizontal_bar':
            bars = ax.barh(label_list, value_list, color=colors[:len(label_list)], edgecolor='white', linewidth=0.5)
            for bar, val in zip(bars, value_list):
                ax.text(val + max(value_list) * 0.02, bar.get_y() + bar.get_height() / 2.,
                        f'{val}', ha='left', va='center', fontweight='bold', color='white', fontsize=10)

        else:
            return f"Unknown chart type '{chart_type}'. Supported: bar, pie, line, horizontal_bar."

        ax.set_title(title, fontsize=16, fontweight='bold', color='white', pad=20)
        ax.tick_params(colors='white')
        for spine in ax.spines.values():
            spine.set_color('#333')

        plt.tight_layout()
        plt.savefig(save_path, dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor())
        plt.close()

        return f"Chart saved to: {save_path}\nType: {chart_type} | Title: {title} | Data points: {len(label_list)}"
    except Exception as e:
        return f"Error creating chart: {str(e)}"


# ═══════════════════════════════════════════════════════════════════════════════
#  TOOL SCHEMAS
# ═══════════════════════════════════════════════════════════════════════════════


# ─── New Features ────────────────────────────────────────────────────────────

def weather_fetch(location: str) -> str:
    """Fetches weather data for a location."""
    try:
        import requests
        geo = requests.get(f"https://geocoding-api.open-meteo.com/v1/search?name={location}&count=1&language=en&format=json", timeout=5).json()
        if not geo.get("results"): return f"Location {location} not found."
        lat, lon, name = geo["results"][0]["latitude"], geo["results"][0]["longitude"], geo["results"][0]["name"]
        w = requests.get(f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true", timeout=5).json()
        if "current_weather" in w:
            return f"Weather in {name}: {w['current_weather']['temperature']}°C, Wind {w['current_weather']['windspeed']} km/h"
        return "Weather data unavailable."
    except Exception as e:
        return f"Error: {e}"

def currency_convert(amount: float, from_currency: str, to_currency: str) -> str:
    """Converts currency."""
    try:
        import requests
        r = requests.get(f"https://api.exchangerate-api.com/v4/latest/{from_currency.upper()}", timeout=5).json()
        if "rates" in r and to_currency.upper() in r["rates"]:
            rate = r["rates"][to_currency.upper()]
            return f"{amount} {from_currency.upper()} = {amount * rate:.2f} {to_currency.upper()} (Rate: {rate})"
        return "Currency not supported."
    except Exception as e:
        return f"Error: {e}"

def stock_quote(symbol: str) -> str:
    """Gets stock price."""
    try:
        import requests
        headers = {'User-Agent': 'Mozilla/5.0'}
        r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d", headers=headers, timeout=5).json()
        res = r["chart"]["result"][0]["meta"]
        return f"{symbol.upper()}: {res['regularMarketPrice']} {res['currency']}"
    except Exception as e:
        return f"Error: {e}"

def calculator(expression: str) -> str:
    """Evaluates math expression safely."""
    try:
        # Extremely basic safe eval
        allowed = "0123456789+-*/(). "
        if not all(c in allowed for c in expression): return "Error: Invalid characters in expression."
        return str(eval(expression, {"__builtins__": None}, {}))
    except Exception as e:
        return f"Error: {e}"


TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "weather_fetch",
            "description": "Get current weather for a location.",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "currency_convert",
            "description": "Convert currency.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number"},
                    "from_currency": {"type": "string"},
                    "to_currency": {"type": "string"}
                },
                "required": ["amount", "from_currency", "to_currency"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "stock_quote",
            "description": "Get latest stock price.",
            "parameters": {
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Evaluate math expression.",
            "parameters": {
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "run_terminal_command",
            "description": "Executes a terminal command on the user's desktop. Always asks for confirmation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The shell command to execute (PowerShell/CMD syntax)."}
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Reads the text contents of a file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {"type": "string", "description": "Absolute path to the file."}
                },
                "required": ["filepath"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Creates or overwrites a file with new content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {"type": "string", "description": "Absolute path to the file."},
                    "content": {"type": "string", "description": "The content to write."}
                },
                "required": ["filepath", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Searches the web for up-to-date information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query."}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "system_info",
            "description": "Returns detailed system information: OS, CPU, RAM, disk, battery, and top processes.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_files",
            "description": "Searches for files matching a glob pattern recursively in a directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "search_path": {"type": "string", "description": "The directory to search in (absolute path)."},
                    "pattern": {"type": "string", "description": "Glob pattern to match, e.g. '*.py', '*.txt', 'config*'."}
                },
                "required": ["search_path", "pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "open_url",
            "description": "Opens a URL in the user's default web browser.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to open."}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_webpage",
            "description": "Fetches a webpage and extracts its readable text content. Useful for reading articles, documentation, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL of the webpage to read."}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "notes",
            "description": "Manage persistent notes/todos. Actions: 'add' (create note), 'list' (show all), 'view' (read one), 'delete' (remove one).",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "description": "Action to perform: add, list, view, or delete."},
                    "title": {"type": "string", "description": "Title of the note (or ID for view/delete)."},
                    "content": {"type": "string", "description": "Content of the note (only for 'add' action)."}
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_image",
            "description": "Generates an AI image from a text prompt and saves it as PNG. Uses Pollinations.ai (free).",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "Detailed text description of the image to generate."},
                    "filename": {"type": "string", "description": "Optional filename for the image (without path)."}
                },
                "required": ["prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "send_email",
            "description": "Sends an email via Gmail SMTP. Requires email_config.json with sender credentials.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient email address."},
                    "subject": {"type": "string", "description": "Email subject line."},
                    "body": {"type": "string", "description": "Email body text."}
                },
                "required": ["to", "subject", "body"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "plot_chart",
            "description": "Creates a chart (bar, pie, line, horizontal_bar) from data and saves as PNG image.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chart_type": {"type": "string", "description": "Type of chart: bar, pie, line, or horizontal_bar."},
                    "title": {"type": "string", "description": "Title of the chart."},
                    "labels": {"type": "string", "description": "Comma-separated labels (e.g. 'Python, JavaScript, Go')."},
                    "values": {"type": "string", "description": "Comma-separated numeric values (e.g. '45, 30, 25')."},
                    "filename": {"type": "string", "description": "Optional filename for the chart image."}
                },
                "required": ["chart_type", "title", "labels", "values"]
            }
        }
    }
]

# Map names to functions for easy dispatch
AVAILABLE_FUNCTIONS = {
    "run_terminal_command": run_terminal_command,
    "read_file": read_file,
    "write_file": write_file,
    "search_web": search_web,
    "system_info": system_info,
    "find_files": find_files,
    "open_url": open_url,
    "read_webpage": read_webpage,
    "notes": notes,
    "generate_image": generate_image,
    "send_email": send_email,
    "plot_chart": plot_chart,
    "weather_fetch": weather_fetch,
    "currency_convert": currency_convert,
    "stock_quote": stock_quote,
    "calculator": calculator,

}
