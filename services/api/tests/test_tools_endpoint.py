from app.tools.registry import get_tool_specs


async def test_list_tools_requires_auth(http_client):
    resp = await http_client.get("/tools")
    assert resp.status_code == 401


async def test_list_tools_matches_the_real_registry(http_client, auth_headers):
    resp = await http_client.get("/tools", headers=auth_headers)
    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()}
    assert names == {t.name for t in get_tool_specs()}
    assert all(t["description"] for t in resp.json())
