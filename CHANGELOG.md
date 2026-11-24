# Historial de cambios

## 0.4.0

- Resolución automática de PayPal.Me sin cuenta: consulta HTTP directa y extracción de datos embebidos (nombre, apellidos, foto, localidad, país, verificación, tipo de cuenta, IDs internos, divisa).
- Reintento automático en pestaña en segundo plano si PayPal no devuelve datos o presenta un reto.
- Email: Gravatar por SHA-256 y alias derivados del correo; encadenado automático de alias de Gravatar.
- Teléfono: normalización E.164 por país, formatos y pivotes.
- Modo lote (hasta 25 identificadores) con limitador de ritmo.
- Variantes del alias.
- Fichas con sello de estado, puntuación de confianza, copia por campo y pivotes (Google, LinkedIn, Facebook, WhatsMyName, redes, búsqueda inversa de imagen).
- Cadena de custodia: SHA-256 de fuentes, fotos y capturas; copia local de la foto; registro de actuaciones en UTC.
- Captura de pantalla de la fuente adjunta a la ficha.
- Informe policial imprimible con expediente e investigador, fichero .sha256, y exportación JSON/CSV/TXT por carpeta de expediente.
- Sesión autoguardada e historial de 30 sesiones recuperables.
- Nueva interfaz azul de tipo policial con el logotipo RASTRO PayPal Resolver.

## 0.3.1

- Incorporación del logotipo oficial de RASTRO en la consola.
- Nuevos iconos de extensión derivados del logotipo oficial.
- Paquete de Release corregido con todos los recursos gráficos locales.

## 0.3.0

- Consola investigativa en pestaña completa.
- Recuperación automática de una consola abierta.
- Selector de pestañas PayPal.
- Reconocimiento de `paypal.com/paypalme/username`.
- Mejora de nombre, username y localidad.
- Priorización del avatar frente a logotipos y cabeceras.
- Logotipo oficial e iconos RASTRO.

## 0.2.0

- Visor y descarga de fotografías.
- Fotografía en el informe HTML.
- Pivotes sobre nombre y username.
- Interfaz ampliada.

## 0.1.0

- Primera versión experimental.
- Apertura de PayPal.Me.
- Búsqueda asistida por correo y teléfono.
- Captura controlada y exportación TXT/HTML.
