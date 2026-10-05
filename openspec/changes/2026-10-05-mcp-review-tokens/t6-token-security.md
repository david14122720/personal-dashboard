# T6 — Auditoría y mejoras seguridad tokens (2026-10-05)

## Auditoría (código leído, sin cambios)

- **Entropía OK**: `auth/tokens.rs::generate_token` usa `rand::rng().fill_bytes` sobre 32 bytes
  (256-bit). En `rand 0.10`, `ThreadRng` es un CSPRNG ChaCha12 sembrado desde el OS
  (`getrandom`); codificado base64url sin padding → 43 chars, más prefijo `pd_` (46 total).
  Test `minted_raw_token_has_pd_prefix_and_8_char_display_prefix` lo fija.
- **Hash OK**: `hex(SHA-256(raw))`, vector conocido verificado en test; en DB solo viaja el
  hash (`token_hash`). Comparación en SQL por igualdad de hash; `hashes_equal` (tiempo
  constante) disponible.
- **Prefijo display OK**: 8 primeros chars (`pd_` + 5 de entropía ≈ 30 bits, solo UI).
  Inútil para autenticar sin la preimagen de 256-bit. List/revoke jamás lo exponen más allá
  del display; test `list_shape_carries_no_secret_material` lo fija.
- **Creación solo-sesión OK**: `create_token_handler` usa `require_session_user_id`
  (tabla `sessions` únicamente); un API token filtrado no puede mintear (test
  `tokens_create_requires_session_not_api_token`, 401 + nada escrito).
- **Listado parcial OK**: `ApiTokenResponse` sin secreto/hash; `no-store` solo en el 201
  de creación (el raw sale exactamente una vez).
- **Revoke inmediato OK**: `middleware::resolve_token_user_id` hace lookup fresco a DB en
  cada request (`revoked_at IS NULL` en SQL); **no existe ninguna caché** (ni en memoria
  ni en ningún middleware) entre revoke y el siguiente uso. Test nuevo
  `tokens_revoked_token_fails_closed_immediately_via_handlers` (crear→revocar→usar = 401
  a nivel handler + resolve).

## Cambio implementado (único)

**Rate-limit en `POST /api/tokens`** — no existía; el limiter solo cubría `/login`.

- Dónde: `auth/rate_limit.rs` (presupuesto `by_token_minter` sobre el `LoginRateLimiter`
  compartido → `AppState` intacto) + gate en `routes/tokens.rs::create_token_handler`.
- **Límite: 10 mints exitosos / usuario / hora rodante** (in-process, single-replica,
  misma asunción DD5 que el limiter de login).
- Por qué 10/h: crear tokens es raro y humano (nuevo dispositivo, secreto CI); 10/h nunca
  bloquea uso legítimo pero acota a 10 las credenciales persistentes que una sesión robada
  puede farmear. Solo el mint exitoso consume (422/409/429 no queman presupuesto).
- Orden: sesión (401) → validación (422) → limiter (429) → insert (409/201).
- 429: `AppError::RateLimited` existente → `{"code":"RATE_LIMITED","message":"Too many
  requests"}` + header `Retry-After`; genérico, sin material de token (assert en test).

## Fix J-01 (Judgment Day, 2026-10-05): reserva atómica del mint

**Hallazgo confirmado**: `check_token_mint` y `record_token_mint` tomaban el lock por
separado, con el insert SQL (`.await`) entre ambos: K `POST /api/tokens` concurrentes de
una misma sesión podían pasar todos el chequeo antes del primer registro y mintear
K tokens (K ≫ 10).

**Fix**: `LoginRateLimiter::reserve_token_mint` hace chequeo + reserva bajo el mismo
guard y devuelve `TokenMintReservation`; el presupuesto se consume al reservar, antes del
insert. `create_token_handler` llama `commit()` solo tras el insert exitoso; cualquier
retorno temprano (409/500) libera la reserva vía `Drop` (rollback), así que ningún fallo
consume cuota. Orden intacto 401→422→429→409/201; list/revoke siguen sin presupuesto;
in-process single-replica (sin Redis).

**Tests**: `concurrent_reservations_never_exceed_the_cap` (24 hilos vs cap 3),
`held_reservation_counts_against_the_budget_before_commit`,
`committed_reservation_keeps_consuming_budget` y burst DB real
`tokens_create_concurrent_burst_never_exceeds_budget` (12 creates concurrentes vs cap 3,
≤ cap filas). `cd backend && cargo test` con DB de producción: 417 unit + 43 integración,
0 fallos; usuarios efímeros borrados (0 restos).

## Decisiones documentadas (sin cambio de código)

- **`GET /api/tokens` NO se toca**: el `last_used_at` solo se escribe cuando el caller se
  autentica con un API token (uso real del secreto); con sesión no hay write (test
  `tokens_session_takes_priority_over_api_token`). Quitarlo rompería el test existente
  `tokens_api_token_authenticates_and_touches_last_used` y aportaría poco.
- **Sin rate-limit al *uso* de token**: cada request autenticada resuelve el token; limitar
  uso = DoS a uso legítimo. Fuerza bruta no aplica (256-bit no adivinable). El riesgo real
  (farming con sesión robada) lo cubre el límite de creación.
- **Lecturas y revokes sin presupuesto**: `GET /tokens` y `DELETE /tokens/{id}` jamás
  consultan el limiter; un revoke tras compromiso nunca puede salir 429.
- **MCP**: `mcp-dashboard` usa los mismos Bearer contra este backend (`client.ts`
  per-request); la revocación aplica al instante también vía MCP. Sin cambios allí.
- **Sin migraciones, sin nuevas deps** (uuid/rand ya eran dependencias).

## Riesgos residuales (fuera de T6)

- Multi-réplica: el limiter es in-process; con >1 réplica cada una lleva su presupuesto
  (misma limitación preexistente del limiter de login, DD5). Un limiter compartido
  (Redis) queda como trabajo futuro, no T6/T7.
- Sin audit log de creación/revoke (eso es T7).
