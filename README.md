# SEPRIGUA — repositorio de código (GitHub)

Versión depurada del sistema SEPRIGUA a partir de la entrega del 13/10/2026.

## ¿Qué contiene?

- `index.html`, `chatbot.html`, `login.html`, `sistema.html`: landing, chatbot y portales.
- `css/`, `java/`, `assets/`: presentación, interacciones y recursos del diseño vigente.
- `backend/`: código Flask y lógica de negocio. **Este código NO se ejecuta en GitHub Pages.**
- `requirements.txt`, `requirements.lock.txt`: dependencias para instalar el backend en otro equipo o VM.
- `.env.example`: plantilla pública sin contraseñas ni claves.
- `tests/`, `scripts/verificar_local.py`: pruebas y revisión estática opcionales.
- `deploy/`: ejemplos de despliegue en servidor, sin certificados privados.

## No contiene

`.env` real, claves VAPID ni de recuperación, `.seprigua-private`, expedientes laborales,
`.venv`, cachés compiladas, copias de datos, reportes temporales ni el iniciador local.
**No subas estos archivos después**. Los datos de empresa pertenecen solo al servidor privado.

## Para usarlo con Flask y SQL Server

1. Descarga/clona el repositorio en la computadora o la VM destinada al backend.
2. Usa Python compatible y Microsoft ODBC Driver 18 for SQL Server.
3. Crea un entorno virtual NUEVO (no reutilices `.venv` de otra computadora):

   ```bash
   python -m venv .venv
   # Windows: .venv\Scripts\activate
   # Linux/macOS: source .venv/bin/activate
   python -m pip install -r requirements.txt
   ```

4. Copia `.env.example` a `.env` **solo en el equipo que ejecuta Flask**, e ingresa allí la conexión real de SQL Server. Mantén este archivo fuera de GitHub.
5. Ejecuta desde la raíz: `python -m backend.run_waitress`.
6. Abre `http://127.0.0.1:5000/login` en ese equipo. Para acceso externo, usa dominio y HTTPS con proxy inverso, políticas de cookie y hosts configuradas.

El frontend consume rutas `/api/...` y el login redirige a `/sistema/<rol>`. El sistema
está preparado para consumir esas rutas en el **mismo origen HTTP(S) del backend**.

## ¿Y GitHub Pages?

GitHub sirve para **guardar/publicar el código**. GitHub Pages solo puede alojar
archivos estáticos. Subir estos archivos a Pages puede mostrar la landing, pero **no
activará el login, las solicitudes, órdenes, evidencias ni el formulario de contacto**.
Actualmente estas funciones necesitan `/api` y sesiones en Flask. Para separar el
frontend en Pages de forma funcional se necesitaría configurar URL pública HTTPS del
backend, rutas, cookies/CORS y seguridad. **No se incluye una configuración ficticia**
que pueda dejar expuestos los datos ni un backend en el navegador.

Para una versión funcional inmediata, la recomendación es mantener el frontend y el
backend sirviéndose desde un mismo dominio mediante Flask/proxy y publicar en GitHub
este repositorio como fuente del código.

## Integridad del sistema

La limpieza es del **paquete de distribución**: no cambia HTML/CSS/JS funcional, APIs,
Flask, autenticación, reglas de negocio, esquemas o procedimientos SQL. No se añadió
ningún SQL a este repositorio. No reemplaces archivos privados de tu VM por plantillas.

Prueba el recorrido de login, solicitudes, órdenes, evidencias, cotizaciones y garantías
contra tu base de datos de ensayos antes de la publicación empresarial.
