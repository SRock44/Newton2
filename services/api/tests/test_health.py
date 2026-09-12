async def test_health_unauthenticated(http_client):
    resp = await http_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_health_secure_requires_token(http_client):
    resp = await http_client.get("/health/secure")
    assert resp.status_code == 401


async def test_health_secure_with_valid_token(http_client, auth_headers):
    resp = await http_client.get("/health/secure", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["subject"]  # keycloak "sub" claim echoed back
