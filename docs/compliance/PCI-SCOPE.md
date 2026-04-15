# Alcance PCI-DSS y modelo SAQ (objetivo)

Este documento fija las decisiones de arquitectura para **reducir el alcance** del entorno que procesa datos de titular de tarjeta (CDE). La validación formal del cuestionario SAQ y el alcance final deben ser revisados por un **asesor QSA o asesor PCI** antes de producción.

## Principios

1. Los datos sensibles de tarjeta (PAN, CVV, datos de autenticación 3DS completos) **no transitan ni se almacenan** en los sistemas del comercio integrador.
2. El PSP expone **checkout alojado** (`pay.*`) o **redirect** al recolector del adquirente/tokenizador.
3. Los servicios del PSP que **no** forman parte del flujo de datos de tarjeta permanecen fuera del CDE (ledger, webhooks de negocio sin PAN, dashboard).

## Matriz de integración → SAQ objetivo

| Modelo de captura | PAN en servidores del PSP | SAQ típico (referencia) | Notas |
|-------------------|---------------------------|-------------------------|--------|
| Redirect completo al adquirente (hosted payment page del banco/PSP agregador) | No | **SAQ A** | Mínimo alcance si el comercio solo recibe token/estado. |
| iFrame/hosted fields del adquirente; JavaScript del adquirente en página PSP | Depende del proveedor y contrato | **SAQ A-EP** u otro | Requiere análisis: si el PSP **el mismo** aloja la página y los campos son del proveedor PCI, el alcance se concentra en esa página y en la red segmentada. |
| API directa con PAN al backend del PSP | Sí (CDE amplio) | **SAQ D** (merchant/PSP) | Evitar en diseño MVP. |

**Decisión de diseño para este producto:** priorizar **redirect o hosted fields del adquirente** en el dominio `pay.<psp>` para orientar el roadmap hacia **SAQ A o A-EP** en el lado del comercio integrador; el PSP asume responsabilidades propias de **SAQ D** o programa equivalente para su plataforma si almacena o procesa datos de tarjeta según el contrato con redes y adquirente.

## Componentes dentro / fuera de CDE (referencia)

- **Dentro (CDE mínimo):** balanceador y aplicación que sirve el checkout, componentes que reciben o transmiten PAN, integración tokenización, logs que puedan capturar datos sensibles (deben estar deshabilitados/redactados).
- **Fuera:** API de payment-links sin PAN, ledger, motor de riesgo que solo ve metadata, notificaciones webhook con IDs y estado (sin PAN), KYC documental en almacenamiento objeto cifrado.

## Controles transversales (siempre)

- TLS 1.2+ en tránsito; cifrado en reposo para PII y tokens.
- Segmentación de red entre CDE y backoffice.
- MFA para acceso administrativo; RBAC; auditoría de accesos.
- Política de retención: no guardar datos sensibles más allá de lo permitido por el adquirente.

## Acción requerida antes de producción

- Contratar **revisión QSA** o consultor PCI para mapear el flujo real (proveedor de adquirente elegido, diagramas de red) y asignar el **SAQ** definitivo y el programa de remediación.
  