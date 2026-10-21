/**
 * Consulta de Radicados PQRS — Lógica del Cliente
 * Maneja el formulario, la conexión SSE para progreso en tiempo real
 * y las interacciones de la interfaz.
 */

document.addEventListener("DOMContentLoaded", () => {
    // === Elementos del DOM ===
    const form = document.getElementById("formulario");
    const btnGenerar = document.getElementById("btnGenerar");
    const btnLimpiar = document.getElementById("btnLimpiar");
    const btnHistorial = document.getElementById("btnHistorial");
    const btnCerrarModal = document.getElementById("btnCerrarModal");
    const btnNuevoReporte = document.getElementById("btnNuevoReporte");
    const modalOverlay = document.getElementById("modalOverlay");
    const modalBody = document.getElementById("modalBody");
    const progressPanel = document.getElementById("progressPanel");
    const progressBar = document.getElementById("progressBar");
    const progressBadge = document.getElementById("progressBadge");
    const progressTitle = document.getElementById("progressTitle");
    const spinnerIcon = document.getElementById("spinnerIcon");
    const statProcessed = document.getElementById("statProcessed");
    const statCurrent = document.getElementById("statCurrent");
    const statErrors = document.getElementById("statErrors");
    const eventLog = document.getElementById("eventLog");
    const resultPanel = document.getElementById("resultPanel");
    const resultMessage = document.getElementById("resultMessage");
    const btnDescargar = document.getElementById("btnDescargar");
    const rangeInfo = document.getElementById("rangeInfo");
    const rangeText = document.getElementById("rangeText");

    const inputInicio = document.getElementById("inicio");
    const inputFin = document.getElementById("fin");
    const inputPaso = document.getElementById("paso");

    let errorCount = 0;

    // === Cálculo del rango en tiempo real ===
    function updateRangeInfo() {
        const inicio = parseInt(inputInicio.value);
        const fin = parseInt(inputFin.value);
        const paso = parseInt(inputPaso.value) || 10;

        if (!isNaN(inicio) && !isNaN(fin) && inicio > 0 && fin > 0 && paso > 0) {
            if (inicio > fin) {
                rangeText.textContent = "⚠ El radicado de inicio debe ser menor o igual al fin.";
                rangeInfo.style.borderColor = "rgba(251, 191, 36, 0.3)";
                rangeInfo.style.background = "rgba(251, 191, 36, 0.08)";
                rangeInfo.querySelector("svg").style.color = "#fbbf24";
            } else {
                const total = Math.floor((fin - inicio) / paso) + 1;
                rangeText.textContent = `Se consultarán aproximadamente ${total.toLocaleString("es-CO")} radicados`;
                rangeInfo.style.borderColor = "rgba(96, 165, 250, 0.15)";
                rangeInfo.style.background = "rgba(96, 165, 250, 0.08)";
                rangeInfo.querySelector("svg").style.color = "";
            }
        } else {
            rangeText.textContent = "Ingrese los valores para ver el total de registros estimados";
            rangeInfo.style.borderColor = "";
            rangeInfo.style.background = "";
        }
    }

    inputInicio.addEventListener("input", updateRangeInfo);
    inputFin.addEventListener("input", updateRangeInfo);
    inputPaso.addEventListener("input", updateRangeInfo);

    // === Función para obtener timestamp legible ===
    function getTimestamp() {
        const now = new Date();
        return now.toLocaleTimeString("es-CO", { hour12: false });
    }

    // === Agregar entrada al log de eventos ===
    function addLogEntry(message, type = "info") {
        const entry = document.createElement("div");
        entry.className = `log-entry ${type}`;
        entry.innerHTML = `
            <span class="log-time">${getTimestamp()}</span>
            <span class="log-msg">${message}</span>
        `;
        eventLog.appendChild(entry);
        eventLog.scrollTop = eventLog.scrollHeight;
    }

    // === Enviar formulario ===
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const inicio = inputInicio.value.trim();
        const fin = inputFin.value.trim();
        const paso = inputPaso.value.trim();
        const nombre = document.getElementById("nombre").value.trim();

        if (!inicio || !fin) {
            addLogEntry("Por favor ingrese los valores de inicio y fin.", "warning");
            return;
        }

        // Deshabilitar formulario
        btnGenerar.disabled = true;
        btnGenerar.querySelector("span").textContent = "Iniciando...";

        // Resetear panel de progreso
        errorCount = 0;
        progressPanel.classList.remove("hidden");
        resultPanel.classList.add("hidden");
        progressBar.style.width = "0%";
        progressBadge.textContent = "0%";
        statProcessed.textContent = "0 / 0";
        statCurrent.textContent = "—";
        statErrors.textContent = "0";
        spinnerIcon.style.display = "block";
        progressTitle.textContent = "Procesando radicados...";
        eventLog.innerHTML = "";

        // Scroll al panel de progreso
        progressPanel.scrollIntoView({ behavior: "smooth", block: "start" });

        try {
            const response = await fetch("/generar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ inicio, fin, paso, nombre })
            });

            const data = await response.json();

            if (!response.ok) {
                addLogEntry(data.error || "Error al iniciar el proceso.", "error");
                btnGenerar.disabled = false;
                btnGenerar.querySelector("span").textContent = "Generar CSV";
                return;
            }

            addLogEntry("Conexión establecida con el servidor.", "success");

            // Iniciar SSE para recibir progreso
            const evtSource = new EventSource(`/progreso/${data.task_id}`);

            evtSource.onmessage = (event) => {
                const msg = JSON.parse(event.data);

                switch (msg.type) {
                    case "start":
                        addLogEntry(msg.message, "info");
                        break;

                    case "info":
                        addLogEntry(msg.message, "info");
                        break;

                    case "progress":
                        progressBar.style.width = `${msg.percent}%`;
                        progressBadge.textContent = `${msg.percent}%`;
                        statProcessed.textContent = `${msg.current} / ${msg.total}`;
                        statCurrent.textContent = msg.radicado;

                        if (msg.error) {
                            errorCount++;
                            statErrors.textContent = errorCount;
                            statErrors.style.color = "var(--error)";
                        }

                        // Log cada 50 radicados o si hay error
                        if (msg.current % 50 === 0 || msg.current === msg.total || msg.error) {
                            if (msg.error) {
                                addLogEntry(`Radicado ${msg.radicado}: Error de conexión`, "error");
                            } else {
                                addLogEntry(
                                    `Radicado ${msg.radicado} — ${msg.asunto ? msg.asunto.substring(0, 60) : "sin datos"}`,
                                    "info"
                                );
                            }
                        }
                        break;

                    case "complete":
                        evtSource.close();
                        spinnerIcon.style.display = "none";
                        progressTitle.textContent = "¡Proceso finalizado!";
                        progressBar.style.width = "100%";
                        progressBadge.textContent = "100%";

                        addLogEntry(msg.message, "success");

                        resultPanel.classList.remove("hidden");
                        resultMessage.textContent = msg.message;
                        btnDescargar.href = `/descargar/${msg.filename}`;

                        btnGenerar.disabled = false;
                        btnGenerar.querySelector("span").textContent = "Generar CSV";
                        break;

                    case "error":
                        evtSource.close();
                        spinnerIcon.style.display = "none";
                        progressTitle.textContent = "Error en el proceso";
                        addLogEntry(msg.message, "error");

                        btnGenerar.disabled = false;
                        btnGenerar.querySelector("span").textContent = "Generar CSV";
                        break;

                    case "heartbeat":
                        // Mantiene la conexión viva
                        break;
                }
            };

            evtSource.onerror = () => {
                evtSource.close();
                addLogEntry("Se perdió la conexión con el servidor.", "error");
                spinnerIcon.style.display = "none";
                btnGenerar.disabled = false;
                btnGenerar.querySelector("span").textContent = "Generar CSV";
            };

        } catch (err) {
            addLogEntry(`Error de red: ${err.message}`, "error");
            btnGenerar.disabled = false;
            btnGenerar.querySelector("span").textContent = "Generar CSV";
        }
    });

    // === Botón Nuevo Reporte ===
    if (btnNuevoReporte) {
        btnNuevoReporte.addEventListener("click", () => {
            progressPanel.classList.add("hidden");
            form.reset();
            inputPaso.value = "10";
            document.getElementById("nombre").value = "radicados.csv";
            updateRangeInfo();
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    }

    // === Botón Limpiar ===
    btnLimpiar.addEventListener("click", () => {
        setTimeout(updateRangeInfo, 10);
    });

    // === Modal de Historial ===
    btnHistorial.addEventListener("click", async () => {
        modalOverlay.classList.remove("hidden");
        modalBody.innerHTML = '<p class="loading-text">Cargando archivos...</p>';

        try {
            const response = await fetch("/archivos");
            const archivos = await response.json();

            if (archivos.length === 0) {
                modalBody.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                        </svg>
                        <p>No hay archivos generados aún.</p>
                    </div>
                `;
            } else {
                const items = archivos.map(f => `
                    <li class="file-item">
                        <div class="file-info">
                            <span class="file-name">${f.nombre}</span>
                            <span class="file-meta">${f.tamaño_kb} KB · ${f.fecha_modificacion}</span>
                        </div>
                        <a href="/descargar/${f.nombre}" class="file-download">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                            </svg>
                            Descargar
                        </a>
                    </li>
                `).join("");

                modalBody.innerHTML = `<ul class="file-list">${items}</ul>`;
            }
        } catch (err) {
            modalBody.innerHTML = `<p class="loading-text" style="color: var(--error)">Error al cargar archivos: ${err.message}</p>`;
        }
    });

    btnCerrarModal.addEventListener("click", () => {
        modalOverlay.classList.add("hidden");
    });

    modalOverlay.addEventListener("click", (e) => {
        if (e.target === modalOverlay) {
            modalOverlay.classList.add("hidden");
        }
    });

    // Cerrar modal con Escape
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !modalOverlay.classList.contains("hidden")) {
            modalOverlay.classList.add("hidden");
        }
    });
});
