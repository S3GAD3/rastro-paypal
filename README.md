# RASTRO PayPal Resolver

Extensión experimental de navegador para apoyar investigaciones OSINT sobre perfiles públicos de PayPal.Me y destinatarios mostrados legítimamente por PayPal.

Forma parte de **RASTRO — Kit de Investigación de Fuentes Abiertas**, creado por **S3GAD3**.

![Logotipo oficial de RASTRO](assets/rastro-logo.jpg)

> **Proyecto independiente.** No está afiliado, patrocinado ni aprobado por PayPal. PayPal y PayPal.Me son marcas de sus respectivos titulares.
>
> Puede descargar el archivo .zip para la instalación y uso de la extensión en el apartado releases: https://github.com/S3GAD3/rastro-paypal/releases/tag/v0.3.0

## Objetivo

RASTRO PayPal Resolver permite:

- construir y abrir un perfil `paypal.me/username`;
- preparar búsquedas manuales por correo electrónico o teléfono;
- seleccionar una pestaña de PayPal abierta en el navegador;
- capturar únicamente la información que PayPal ya muestra en pantalla;
- extraer nombre, username, localidad, tipo de perfil y posible fotografía;
- revisar los campos antes de conservarlos;
- pivotar sobre el nombre y el username;
- exportar el resultado a TXT o HTML.

No es un enumerador de cuentas y no utiliza APIs privadas de PayPal.

## Funcionamiento

Al pulsar el icono se abre una consola investigativa en una pestaña completa. Si ya existe, se recupera esa misma pestaña.

1. Introduce un username, correo o teléfono.
2. Abre PayPal.Me o el buscador legítimo de destinatarios.
3. Regresa a la consola pulsando otra vez el icono.
4. Selecciona la pestaña de PayPal que contiene el resultado.
5. Pulsa **Analizar lo visible en PayPal**.
6. Revisa los campos antes de guardar o exportar.

El analizador se ejecuta exclusivamente cuando el usuario pulsa el botón de captura.

## Métodos de entrada

### Username

Construye el enlace público:

```text
https://www.paypal.me/username
```

La coincidencia del username es solo un indicio. Debe contrastarse con el nombre, la fotografía, la localidad y otras fuentes independientes.

### Correo electrónico

El correo se copia al portapapeles y se abre el flujo de destinatarios de PayPal para realizar una comprobación manual.

La ausencia de resultado no demuestra que la cuenta no exista. Puede deberse a la configuración de privacidad, al país, al tipo de cuenta o a cambios de la plataforma.

### Teléfono

Funciona como búsqueda asistida. Conviene normalizar previamente el número con su prefijo internacional.

## Datos que puede detectar

- nombre mostrado;
- username;
- localidad o pista geográfica visible;
- tipo de perfil;
- URL de la posible fotografía;
- URL y título de la página fuente;
- fecha y hora de captura;
- metadatos técnicos visibles.

La detección de fotografías puntúa los elementos visibles para priorizar avatares cuadrados o circulares y descartar logotipos, iconos y cabeceras.

## Estados metodológicos

- **LOCALIZADO:** se detectaron señales visibles compatibles con un perfil.
- **NO LOCALIZADO PÚBLICAMENTE:** PayPal muestra expresamente una señal de perfil público no encontrado.
- **REVISIÓN MANUAL:** no existe evidencia suficiente o la interfaz no coincide con los selectores conocidos.

La aplicación no debe utilizarse para afirmar que una persona “no tiene PayPal”. La formulación correcta es:

> Sin perfil PayPal públicamente localizable mediante este identificador en el momento de la comprobación.

## Instalación

### Chrome

1. Descarga o clona el repositorio.
2. Abre `chrome://extensions`.
3. Activa **Modo desarrollador**.
4. Pulsa **Cargar descomprimida**.
5. Selecciona la carpeta del proyecto.
6. Fija la extensión a la barra del navegador.

### Brave y Opera

Utiliza el mismo procedimiento desde `brave://extensions` u `opera://extensions`.

## Permisos

| Permiso | Finalidad |
|---|---|
| `activeTab` | Asociar la pestaña desde la que se activa la extensión. |
| `scripting` | Ejecutar el extractor bajo demanda en la pestaña PayPal seleccionada. |
| `storage` | Conservar localmente la configuración y hasta 50 resultados. |
| `downloads` | Exportar informes y descargar la fotografía cuando sea posible. |
| `tabs` | Abrir la consola, seleccionar pestañas PayPal y realizar pivotes. |
| Dominios PayPal | Limitar la captura a páginas de PayPal y PayPal.Me. |

La extensión no solicita acceso general a todos los sitios web.

## Privacidad

- No existe backend.
- No hay telemetría ni analítica.
- No se transmiten resultados al autor.
- No se incluyen credenciales ni tokens.
- El historial permanece en `chrome.storage.local`.
- Las exportaciones se generan en el navegador.

Consulta [PRIVACY.md](PRIVACY.md).

## Exportaciones

### TXT

Incluye campos normalizados, fuente, fecha, notas y evidencia técnica.

### HTML

Genera un informe visual con la fotografía referenciada cuando la URL continúa disponible. Algunas imágenes pueden ser temporales o requerir una sesión válida.

## Pivotes

- Google: nombre exacto.
- Google: username y variante `@username`.
- GitHub: perfil construido desde el username.
- Copia conjunta de nombre, username, localidad y fuente.

Los pivotes abren nuevas búsquedas; no confirman que los resultados pertenezcan a la misma persona.

## Limitaciones

- PayPal puede modificar su interfaz sin previo aviso.
- El resultado puede variar según idioma, país, sesión y tipo de cuenta.
- Las búsquedas por correo o teléfono requieren interacción manual.
- Una fotografía puede estar protegida, ser temporal o no estar disponible.
- El mismo username puede pertenecer a personas diferentes.
- La información extraída debe tratarse conforme a la normativa aplicable.

## Uso responsable

Utiliza la herramienta únicamente en investigaciones legítimas y autorizadas, respetando los principios de necesidad, proporcionalidad, minimización y corroboración.

No utilices el proyecto para acoso, vigilancia no autorizada, campañas masivas, suplantación, fraude o acceso indebido a cuentas.

## Estructura

```text
assets/          Logotipo e iconos locales
background.js    Apertura y recuperación de la consola
console.html     Interfaz investigativa
popup.css        Sistema visual
popup.js         Captura, normalización, pivotes y exportación
manifest.json    Configuración Manifest V3
PRIVACY.md       Política de privacidad
SECURITY.md      Comunicación responsable de vulnerabilidades
CHANGELOG.md     Historial de versiones
LICENSE          Licencia MIT
```

## Desarrollo

HTML, CSS y JavaScript sin dependencias externas ni proceso de compilación.

```bash
node --check popup.js
node --check background.js
python3 -m json.tool manifest.json
```

## Contribuciones

Las mejoras son bienvenidas. Al abrir una incidencia no adjuntes nombres, fotografías, correos, teléfonos, cookies, credenciales ni capturas de personas investigadas. Utiliza perfiles propios o datos ficticios.

## Licencia

Distribuido bajo licencia [MIT](LICENSE). Puedes utilizar, modificar y crear forks conservando el aviso de copyright y la atribución a **S3GAD3**.

## Autor

**S3GAD3** — Proyecto RASTRO.
