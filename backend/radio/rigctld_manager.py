"""WebRig – rigctld process manager.

Starts/stops rigctld as a subprocess and manages the connection.
"""

import subprocess
import logging
import os
import signal
from typing import Optional

log = logging.getLogger(__name__)


class RigctldManager:
    """Manages a rigctld subprocess."""

    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.current_args: list = []

    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def start(self, model: int, device: str, baudrate: int = 9600,
              host: str = "127.0.0.1", port: int = 4532,
              data_bits: int = 8, stop_bits: int = 1,
              parity: str = "None", flow: str = "None") -> bool:
        """Start rigctld with given parameters."""
        self.stop()

        args = [
            "rigctld",
            "-m", str(model),
            "-r", device,
            "-s", str(baudrate),
            "-T", host,
            "-t", str(port),
        ]

        # Serial params
        if data_bits != 8:
            args.extend(["--set-conf", f"data_bits={data_bits}"])
        if stop_bits != 1:
            args.extend(["--set-conf", f"stop_bits={stop_bits}"])
        if parity != "None":
            args.extend(["--set-conf", f"parity={parity.lower()}"])
        if flow == "Hardware":
            args.extend(["--set-conf", "handshake=Hardware"])
        elif flow == "Software":
            args.extend(["--set-conf", "handshake=Software"])

        self.current_args = args

        try:
            self.process = subprocess.Popen(
                args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                preexec_fn=os.setsid,
            )
            log.info(f"rigctld started: {' '.join(args)}")

            # Brief check if it survived startup
            import time
            time.sleep(0.5)
            if self.process.poll() is not None:
                stderr = self.process.stderr.read().decode()
                log.error(f"rigctld failed to start: {stderr}")
                self.process = None
                return False
            return True
        except FileNotFoundError:
            log.error("rigctld binary not found")
            return False
        except Exception as e:
            log.error(f"Failed to start rigctld: {e}")
            return False

    def stop(self):
        """Stop the running rigctld process."""
        if self.process and self.process.poll() is None:
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
                self.process.wait(timeout=3)
                log.info("rigctld stopped")
            except Exception:
                try:
                    os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)
                except Exception:
                    pass
        self.process = None

    def test_connection(self, model: int, device: str, baudrate: int = 9600) -> dict:
        """Test a rigctld connection without keeping it running."""
        # Start temporary rigctld on a test port
        test_port = 4599
        args = [
            "rigctld", "-m", str(model), "-r", device,
            "-s", str(baudrate), "-T", "127.0.0.1", "-t", str(test_port),
        ]
        try:
            proc = subprocess.Popen(
                args, stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE, preexec_fn=os.setsid,
            )
            import time
            time.sleep(1)

            if proc.poll() is not None:
                stderr = proc.stderr.read().decode()
                return {"ok": False, "error": f"rigctld exited: {stderr.strip()}"}

            # Try to connect and get info
            import socket
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(3)
                s.connect(("127.0.0.1", test_port))
                s.sendall(b"\\get_info\n")
                resp = s.recv(4096).decode().strip()
                s.close()

                # Kill the test process
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                proc.wait(timeout=3)

                return {"ok": True, "info": resp}
            except Exception as e:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                return {"ok": False, "error": f"Cannot connect: {e}"}

        except FileNotFoundError:
            return {"ok": False, "error": "rigctld not installed"}
        except Exception as e:
            return {"ok": False, "error": str(e)}


# Singleton
rigctld_mgr = RigctldManager()
