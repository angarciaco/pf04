"""
Aplicación web para consulta de radicados PQRS.
Permite ingresar un rango de radicados mediante un formulario,
realiza scraping del sistema SIEP y genera un archivo CSV con los resultados.
"""

import os
import json
import time
import queue
import threading
from flask import (
    Flask, render_template, request, jsonify,
    Response, send_from_directory, stream_with_context
)
import requests as http_requests
from bs4 import BeautifulSoup
import pandas as pd

app = Flask(__name__)

# Directorio donde se guardarán los archivos CSV generados
CSV_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "csv_output")
os.makedirs(CSV_DIR, exist_ok=True)

# URL base del sistema SIEP
BASE_URL = "http://siep-alclospatios.com:6002/pqrs/form_public_radicado_alca_patios/"

# Parámetros estáticos de la consulta
STATIC_PARAMS = {
    "nmgp_url_saida": "/pqrs/control_enlace_consulta_alca_patios/",
    "script_case_init": "2187",
    "script_case_session": "bmdkonota67qjrmth80hsbhe03"
}

# Headers para simular navegador
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

# Cola global para comunicar progreso entre el hilo de scraping y SSE
progress_queues = {}


def scrape_radicados(inicio, fin, paso, nombre_archivo, task_id):
    """
    Realiza el scraping de radicados en el rango especificado.
    Envía actualizaciones de progreso a través de la cola asociada al task_id.
    """
    q = progress_queues.get(task_id)
    resultados = []
    total = len(range(inicio, fin + 1, paso))

    if total == 0:
        q.put({"type": "error", "message": "El rango especificado no genera radicados para consultar."})
        return

    # Verificar si el archivo CSV ya existe y eliminarlo
    filepath = os.path.join(CSV_DIR, nombre_archivo)
    if os.path.exists(filepath):
        os.remove(filepath)
        q.put({
            "type": "info",
            "message": f"Archivo '{nombre_archivo}' existente eliminado previamente."
        })

    q.put({
        "type": "start",
        "message": f"Iniciando consulta de {total} radicados...",
        "total": total
    })

    with http_requests.Session() as session:
        session.headers.update(HEADERS)

        for idx, radicado in enumerate(range(inicio, fin + 1, paso), start=1):
            # Construcción del parámetro dinámico nmgp_parms
            nmgp_parms_val = (
                f"radi_nume_radi*scin{radicado}*scout"
                "NM_btn_insert*scinN*scout"
                "NM_btn_update*scinN*scout"
                "NM_btn_delete*scinN*scout"
                "NM_btn_navega*scinN*scout"
            )

            params = {"nmgp_parms": nmgp_parms_val, **STATIC_PARAMS}

            asunto_texto = None
            depe_actu_texto = None
            fech_radi_texto = None
            usua_actu_texto = None
            error_msg = None

            try:
                response = session.get(BASE_URL, params=params, timeout=15)
                response.raise_for_status()

                soup = BeautifulSoup(response.text, "html.parser")

                tag_asunto = soup.find(id="id_read_on_ra_asun")
                tag_depe_actu = soup.find(id="id_lookup_radi_depe_actu")
                tag_fech_radi = soup.find(id="id_read_on_radi_fech_radi")
                tag_usua_actu = soup.find(id="id_lookup_radi_usua_actu")

                asunto_texto = tag_asunto.get_text(strip=True) if tag_asunto else None
                depe_actu_texto = tag_depe_actu.get_text(strip=True) if tag_depe_actu else None
                fech_radi_texto = tag_fech_radi.get_text(strip=True) if tag_fech_radi else None
                usua_actu_texto = tag_usua_actu.get_text(strip=True) if tag_usua_actu else None

            except http_requests.RequestException as e:
                error_msg = str(e)
                asunto_texto = f"Error: {e}"

            resultados.append({
                "Radicado": str(radicado),
                "Asunto": asunto_texto,
                "Dependencia Actual": depe_actu_texto,
                "Fecha Radicado": fech_radi_texto,
                "Usuario Actual": usua_actu_texto
            })

            # Enviar progreso
            progress_pct = round((idx / total) * 100, 1)
            q.put({
                "type": "progress",
                "current": idx,
                "total": total,
                "percent": progress_pct,
                "radicado": str(radicado),
                "asunto": asunto_texto or "",
                "error": error_msg
            })

    # Crear DataFrame y guardar CSV
    df = pd.DataFrame(resultados)
    df.to_csv(filepath, index=False, encoding="utf-8-sig")

    q.put({
        "type": "complete",
        "message": f"Proceso completado. {len(df)} registros guardados en '{nombre_archivo}'.",
        "filename": nombre_archivo,
        "total_records": len(df)
    })


@app.route("/")
def index():
    """Renderiza la página principal con el formulario."""
    return render_template("index.html")


@app.route("/generar", methods=["POST"])
def generar():
    """Endpoint que inicia el proceso de scraping en un hilo separado."""
    data = request.get_json()

    try:
        inicio = int(data.get("inicio", 0))
        fin = int(data.get("fin", 0))
        paso = int(data.get("paso", 10))
        nombre = data.get("nombre", "radicados.csv").strip()
    except (ValueError, TypeError):
        return jsonify({"error": "Los valores de inicio, fin y paso deben ser numéricos."}), 400

    if not nombre:
        nombre = "radicados.csv"
    if not nombre.endswith(".csv"):
        nombre += ".csv"

    if inicio <= 0 or fin <= 0:
        return jsonify({"error": "Los valores de inicio y fin deben ser mayores a cero."}), 400

    if inicio > fin:
        return jsonify({"error": "El valor de inicio debe ser menor o igual al fin."}), 400

    if paso <= 0:
        return jsonify({"error": "El paso debe ser mayor a cero."}), 400

    # Crear un ID único para esta tarea
    task_id = f"task_{int(time.time() * 1000)}"
    progress_queues[task_id] = queue.Queue()

    # Iniciar el scraping en un hilo separado
    thread = threading.Thread(
        target=scrape_radicados,
        args=(inicio, fin, paso, nombre, task_id),
        daemon=True
    )
    thread.start()

    return jsonify({"task_id": task_id, "message": "Proceso iniciado correctamente."})


@app.route("/progreso/<task_id>")
def progreso(task_id):
    """Endpoint SSE para enviar progreso en tiempo real al navegador."""
    def generate():
        q = progress_queues.get(task_id)
        if not q:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Tarea no encontrada.'})}\n\n"
            return

        while True:
            try:
                msg = q.get(timeout=120)
                yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"

                if msg.get("type") in ("complete", "error"):
                    # Limpiar la cola al finalizar
                    if task_id in progress_queues:
                        del progress_queues[task_id]
                    break
            except queue.Empty:
                # Enviar heartbeat para mantener la conexión viva
                yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )


@app.route("/descargar/<filename>")
def descargar(filename):
    """Permite descargar el archivo CSV generado."""
    return send_from_directory(
        CSV_DIR,
        filename,
        as_attachment=True,
        mimetype="text/csv"
    )


@app.route("/archivos")
def listar_archivos():
    """Devuelve la lista de archivos CSV generados anteriormente."""
    archivos = []
    if os.path.isdir(CSV_DIR):
        for f in sorted(os.listdir(CSV_DIR)):
            if f.endswith(".csv"):
                filepath = os.path.join(CSV_DIR, f)
                size_kb = round(os.path.getsize(filepath) / 1024, 1)
                mod_time = time.strftime(
                    "%Y-%m-%d %H:%M:%S",
                    time.localtime(os.path.getmtime(filepath))
                )
                archivos.append({
                    "nombre": f,
                    "tamaño_kb": size_kb,
                    "fecha_modificacion": mod_time
                })
    return jsonify(archivos)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000, threaded=True)
