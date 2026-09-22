# Optimización de entrega

- Se eliminó `.venv` de ambos paquetes: se reconstruye en la máquina destino.
- Se eliminaron `__pycache__`, `.pytest_cache` y bytecode.
- Se retiraron hojas CSS y scripts JS heredados sin referencias en la versión actual.
- Se retiraron assets heredados sin referencias comprobadas.
- Las imágenes WebP de gran tamaño se recodificaron manteniendo las mismas dimensiones y nombres, reduciendo el peso de transferencia.
- `pywebpush` y `cryptography` quedaron fijados a las versiones usadas por el entorno actual para evitar instalaciones no reproducibles.
- El arranque de VM ya no ejecuta `pip install` cada vez: la preparación e instalación son un paso separado.
- No se tocaron tablas, columnas, SP, triggers ni estructura de SQL Server.
