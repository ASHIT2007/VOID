import threading
import sys
import os
import re
from rich.console import Console, Group
from rich.markdown import Markdown
from rich.panel import Panel
from rich.prompt import Prompt
from rich.table import Table
from rich.align import Align
from rich.text import Text
from config import MODEL_NAME
from agent import DesktopAgent
from audio_agent import AudioAgent
from stt_agent import STTAgent
from tts_agent import TTSAgent
from pynput import keyboard as pynput_keyboard

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stdin.reconfigure(encoding='utf-8')
    except Exception:
        pass

console = Console()
agent = DesktopAgent()
audio_agent = AudioAgent()
stt_agent = STTAgent()
tts_agent = TTSAgent()
is_recording = False


def create_header_panel():
    try:
        username = os.getlogin()
    except Exception:
        username = "User"
    cwd = os.getcwd()

    table = Table.grid(expand=True)
    table.add_column(ratio=3)
    table.add_column(ratio=2)

    logo = """[bold cyan]
██╗   ██╗ ██████╗ ██╗██████╗       ██╗  ██╗
██║   ██║██╔═══██╗██║██╔══██╗      ╚██╗██╔╝
██║   ██║██║   ██║██║██║  ██║█████╗ ╚███╔╝ 
╚██╗ ██╔╝██║   ██║██║██║  ██║╚════╝ ██╔██╗ 
 ╚████╔╝ ╚██████╔╝██║██████╔╝      ██╔╝ ██╗
  ╚═══╝   ╚═════╝ ╚═╝╚═════╝       ╚═╝  ╚═╝
[/bold cyan]"""

    logo_text = Text.from_markup(logo)
    logo_text.no_wrap = True
    logo_text.overflow = "crop"

    left_content = Group(
        Align.center(Text.from_markup(f"[bold white]Welcome back {username}![/bold white]")),
        Align.center(logo_text),
        Align.center(Text.from_markup(f"[dim]freellmapi · Void Pro\n{cwd}[/dim]", justify="center"))
    )

    right_content = """[bold red]Tips for getting started[/bold red]
[dim]Type anything to chat with VOID-X.
Ask it to search the web or edit files.[/dim]

[bold red]Commands[/bold red]
[dim]/model    — Switch AI model (auto-restarts)
/restart  — Reload VOID-X immediately
/clear    — Clear conversation history
/help     — Show all commands
exit      — Quit VOID-X[/dim]"""

    table.add_row(left_content, right_content)

    return Panel(
        table,
        title="[bold red] VOID-X v1.0.0 [/bold red]",
        title_align="left",
        border_style="red",
        padding=(1, 2)
    )


def restart_program():
    """Restarts the current python program."""
    import os
    import sys
    import subprocess

    try:
        # On Windows, os.execv terminates the parent process immediately and lets the shell (PowerShell/CMD)
        # reclaim the terminal and stdin. Using subprocess.call blocks the parent process and waits
        # for the child process to finish, keeping standard input connected to the active process.
        ret = subprocess.call([sys.executable] + sys.argv)
        sys.exit(ret)
    except Exception:
        try:
            os.execv(sys.executable, [sys.executable] + sys.argv)
        except Exception:
            os.system(f'"{sys.executable}" ' + ' '.join(sys.argv))
            sys.exit(0)


def show_help():
    """Display all available commands."""
    help_text = """
[bold cyan]VOID-X Commands[/bold cyan]

[bold white]/model[/bold white]   — Change the AI model (updates config.py, auto-restarts)
[bold white]/restart[/bold white] — Restart/reload VOID-X immediately (great for loading new code/features)
[bold white]/clear[/bold white]   — Clear conversation history and start fresh
[bold white]/help[/bold white]    — Show this help message
[bold white]exit[/bold white]     — Quit VOID-X  [dim](also: quit, /exit, /quit, Ctrl+C)[/dim]

[bold cyan]AI Tools (12)[/bold cyan]

[bold white]💬 Chat[/bold white]            — Just type naturally to chat with VOID-X.
[bold white]🔍 Web Search[/bold white]      — "search who is elon musk"
[bold white]⚡ Terminal[/bold white]         — "list files in Desktop" [dim](confirms before running)[/dim]
[bold white]📄 Read File[/bold white]       — "read config.py"
[bold white]✏️  Write File[/bold white]      — "create a hello.py script"
[bold white]🖥️  System Info[/bold white]     — "show my system info"
[bold white]🔎 Find Files[/bold white]      — "find all .py files in my project"
[bold white]🌐 Open URL[/bold white]        — "open google.com"
[bold white]📰 Read Webpage[/bold white]    — "read this article: https://..."
[bold white]📝 Notes[/bold white]           — "add a note: buy groceries" / "show my notes"
[bold white]🎨 Generate Image[/bold white]  — "generate an image of a sunset over mountains"
[bold white]📧 Send Email[/bold white]      — "send email to x@gmail.com about meeting" [dim](needs email_config.json)[/dim]
[bold white]📊 Plot Chart[/bold white]      — "make a bar chart of sales data: Q1=100, Q2=200, Q3=150"
"""
    console.print(Panel(help_text.strip(), border_style="cyan", title="[bold cyan] Help [/bold cyan]"))


def start_chat_session():
    """Starts the interactive chat session."""
    console.print(create_header_panel())
    console.print(f"\n[dim]Using {MODEL_NAME} (from config.py) · /model to change[/dim]\n")

    while True:
        try:
            console.print()  # Add visual spacing before prompt
            user_input = Prompt.ask("[bold green]You[/bold green]")

            # ── Exit commands ──
            if user_input.strip().lower() in ['exit', 'quit', '/exit', '/quit']:
                console.print("[dim]Goodbye![/dim]")
                sys.exit(0)

            # ── /help ──
            if user_input.strip().lower() == '/help':
                show_help()
                continue

            # ── /clear ──
            if user_input.strip().lower() == '/clear':
                agent.__init__()  # Reset conversation
                console.clear()
                console.print(create_header_panel())
                console.print(f"\n[dim]Using {MODEL_NAME} (from config.py) · /model to change[/dim]")
                console.print("[bold green]✓ Conversation cleared.[/bold green]\n")
                continue

            # ── /restart ──
            if user_input.strip().lower() == '/restart':
                console.print("[bold green]🔄 Restarting VOID-X...[/bold green]\n")
                restart_program()
                continue

            # ── /model ──
            if user_input.strip().lower() == '/model':
                models = [
                    ("Llama 3.3 Pro", "llama-3.3-70b-versatile"),
                    ("Llama 3.1 Fast", "llama-3.1-8b-instant"),
                    ("Llama 3.2 Vision", "llama-3.2-11b-vision-preview"),
                    ("Gemini 1.5 Flash", "gemini-2.5-flash-lite"),
                    ("Gemma 2 9B", "gemma2-9b-it"),
                    ("Qwen 3 32B", "qwen/qwen3-32b"),
                    ("Llama 4 Scout", "meta-llama/llama-4-scout-17b-16e-instruct"),
                    ("GPT-OSS 120B", "openai/gpt-oss-120b"),
                    ("Compound", "groq/compound"),
                ]
                
                table = Table(title="[bold cyan]Select an AI Model[/bold cyan]", border_style="cyan")
                table.add_column("No.", style="bold yellow", justify="right")
                table.add_column("Display Name", style="white")
                table.add_column("Model ID", style="dim cyan")
                
                for idx, (name, model_id) in enumerate(models, 1):
                    table.add_row(str(idx), name, model_id)
                table.add_row("c", "Custom", "Enter any custom model ID manually")
                
                console.print(table)
                choice = Prompt.ask("[bold yellow]Choose a model number or 'c'[/bold yellow]", default="1")
                
                new_model = ""
                if choice.strip().lower() == 'c':
                    new_model = Prompt.ask("[bold cyan]Enter custom model ID (e.g. gemini-2.5-flash)[/bold cyan]")
                else:
                    try:
                        idx = int(choice.strip()) - 1
                        if 0 <= idx < len(models):
                            new_model = models[idx][1]
                    except ValueError:
                        pass
                
                if new_model.strip():
                    try:
                        with open("config.py", "r") as f:
                            content = f.read()
                        content = re.sub(
                            r'MODEL_NAME\s*=\s*["\'].*?["\']',
                            f'MODEL_NAME = "{new_model.strip()}"',
                            content
                        )
                        with open("config.py", "w") as f:
                            f.write(content)
                        console.print(f"[bold green]✓ Model updated to {new_model.strip()}[/bold green]")
                        console.print("[dim]Restarting VOID-X automatically to apply changes...[/dim]\n")
                        restart_program()
                    except Exception as e:
                        console.print(f"[bold red]Failed to update model:[/bold red] {e}")
                else:
                    console.print("[yellow]Invalid choice. Model not updated.[/yellow]")
                continue

            # ── Empty input ──
            if not user_input.strip():
                continue

            # ── Send to AI agent ──
            with console.status("[dim]Agent is thinking...[/dim]", spinner="dots") as status:
                response = agent.process_user_input(user_input, status=status)

            # Display the AI response inside a distinct panel
            console.print(Panel(
                Markdown(response if response else ""),
                title="[bold cyan]VOID-X[/bold cyan]",
                title_align="left",
                border_style="cyan",
                padding=(1, 2)
            ))

        except KeyboardInterrupt:
            console.print("\n[yellow]Goodbye![/yellow]")
            sys.exit(0)
        except Exception as e:
            console.print(f"\n[bold red]Error:[/bold red] {str(e)}")


def process_voice_input(audio_file):
    try:
        # 1. Transcribe
        with console.status("[dim]Transcribing audio (Groq)...[/dim]", spinner="dots"):
            transcription = stt_agent.transcribe(audio_file)
        
        if not transcription or transcription.strip() == "":
            console.print("[yellow]Could not understand audio.[/yellow]")
            return
            
        console.print(f"\n[bold green]You (Voice):[/bold green] {transcription}")

        # 2. Process via Agent
        with console.status("[dim]Agent is thinking...[/dim]", spinner="dots") as status:
            response = agent.process_user_input(transcription, status=status)
            
        console.print(Panel(
            Markdown(response if response else ""),
            title="[bold cyan]VOID-X (Voice)[/bold cyan]",
            title_align="left",
            border_style="cyan",
            padding=(1, 2)
        ))

        # 3. TTS (Disabled for speech-to-text only)
        pass
    except Exception as e:
        console.print(f"[bold red]Voice Processing Error:[/bold red] {e}")


def on_press(key):
    global is_recording
    if key == pynput_keyboard.Key.ctrl_r and not is_recording:
        is_recording = True
        console.print("\n[bold red]🎤 Recording... (Release Right Ctrl to send)[/bold red]")
        audio_agent.stop_playback()
        audio_agent.start_recording()


def on_release(key):
    global is_recording
    if key == pynput_keyboard.Key.ctrl_r and is_recording:
        is_recording = False
        console.print("[dim]Stopping recording...[/dim]")
        audio_file = audio_agent.stop_recording()
        if audio_file:
            # Run processing in a background thread
            threading.Thread(target=process_voice_input, args=(audio_file,), daemon=True).start()


def wait_for_hotkey():
    """Listens for the global hotkey to notify the user."""
    console.print("[dim]Background listener active. Press and hold 'Right Control' to speak.[/dim]")
    with pynput_keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
        listener.join()


if __name__ == "__main__":
    # Start the hotkey listener in a background thread
    listener_thread = threading.Thread(target=wait_for_hotkey, daemon=True)
    listener_thread.start()

    # Start the main terminal chat loop
    start_chat_session()
