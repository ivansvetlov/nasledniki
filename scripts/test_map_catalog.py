#!/usr/bin/env python3
from shapely.geometry import box

import map_catalog as cat


def test_place_kind() -> None:
    assert cat.place_kind({"name": "Тольятти", "type": "city"}) == "city"
    assert cat.place_kind({"name": "Елховский район", "type": "administrative"}) == "district"
    assert cat.place_kind({"name": "Самарская область", "type": "administrative"}) == "region"
    assert cat.place_kind({"name": "Санкт-Петербург", "type": "administrative"}) == "city"
    assert cat.place_kind({"name": "Москва", "type": "administrative"}) == "city"


def test_merge_city_alone() -> None:
    out = cat.merge_cities([{"name": "Тольятти", "geom": box(0, 0, 1000, 1000)}])
    assert len(out) == 1
    assert out[0]["name"] == "Тольятти"


def test_federal_city_kept() -> None:
    d = {"name": "Ломоносовский район", "geom": box(0, 0, 10, 10)}
    c = {"name": "Санкт-Петербург", "geom": box(20, 20, 30, 30)}
    out = cat.merge_cities([d, c])
    names = {x["name"] for x in out}
    assert "Ломоносовский район" in names
    assert "Санкт-Петербург" in names


def test_host_oblast_cities() -> None:
    assert 337422 in cat.extra_city_ids(176095)
    assert 102269 in cat.extra_city_ids(51490)
    assert cat.extra_city_ids(72193) == []


def test_next_project_name() -> None:
    assert cat.next_project_name({"maps": []}) == "Проект 1"
    assert cat.next_project_name({"maps": [{"name": "Проект 1"}]}) == "Проект 2"


def test_water_body_label_keeps_osm_name() -> None:
    assert cat.water_body_label("Нева") == "Нева"
    assert cat.water_body_label("Ладожское озеро") == "Ладожское озеро"
    assert cat.water_body_label("Невская губа") == "Невская губа"
    assert cat.water_body_label("", {"water": "pond"}) is None
    assert cat.water_body_label("", {"waterway": "riverbank"}) == "река"


def test_osm_water_tags() -> None:
    assert cat.is_osm_water_area({"natural": "water"})
    assert cat.is_osm_water_area({"natural": "bay"})
    assert cat.is_osm_water_area({"waterway": "riverbank"})
    assert not cat.is_osm_water_area({"waterway": "river"})
    assert not cat.is_osm_water_area({"natural": "coastline"})
    assert cat.is_osm_water_relation({"place": "sea"})
    assert cat.is_osm_water_relation({"natural": "water"})
    assert cat._is_clutter_water({"water": "pond"})
    assert not cat._is_clutter_water({"water": "river"})
    tags = cat._tags_from_nominatim(
        {"name": "Невская губа", "category": "natural", "type": "bay"}
    )
    assert tags.get("natural") == "bay"
    assert cat.water_body_label(cat.osm_name(tags), tags) == "Невская губа"


def test_water_rel_too_big() -> None:
    bbox = (29.4, 59.6, 30.8, 60.2)
    gulf = {"bounds": {"minlon": 22.0, "maxlon": 30.5, "minlat": 59.0, "maxlat": 60.7}}
    local = {"bounds": {"minlon": 29.5, "maxlon": 30.4, "minlat": 59.8, "maxlat": 60.1}}
    assert cat.water_rel_too_big(gulf, bbox)
    assert not cat.water_rel_too_big(local, bbox)


def test_water_layer_in_svg() -> None:
    from shapely.geometry import box

    land = [
        {"name": "Левый район", "geom": box(30.0, 59.9, 30.15, 60.1)},
        {"name": "Правый район", "geom": box(30.25, 59.9, 30.4, 60.1)},
    ]
    water = [{"name": "Нева", "geom": box(30.12, 59.92, 30.28, 60.08)}]
    svg, n = cat.svg_from_features(land, 30.2, 60.0, water_feats=water)
    assert n == 2
    assert 'id="water"' in svg
    assert 'data-layer-name="Вода"' in svg
    assert 'data-name="Нева"' in svg
    assert svg.find('id="water"') < svg.find('id="regions"')


def test_large_water_is_clipped_not_dropped() -> None:
    from shapely.geometry import box

    land = [{"name": "Район", "geom": box(30.0, 59.9, 30.4, 60.1)}]
    water = [
        {
            "name": "Залив",
            "geom": box(22.0, 59.0, 30.35, 60.7),
            "tags": {"natural": "bay"},
        }
    ]
    svg, n = cat.svg_from_features(land, 30.2, 60.0, water_feats=water)
    assert n == 1
    assert 'data-name="Залив"' in svg
    assert 'id="water"' in svg


def test_unnamed_pond_is_not_a_body() -> None:
    from shapely.geometry import box

    land = [{"name": "Район", "geom": box(30.0, 59.9, 30.4, 60.1)}]
    water = [
        {
            "name": "",
            "geom": box(30.1, 59.95, 30.12, 59.97),
            "tags": {"natural": "water", "water": "pond"},
        }
    ]
    svg, n = cat.svg_from_features(land, 30.2, 60.0, water_feats=water)
    assert n == 1
    assert 'id="water"' not in svg


def test_overlay_does_not_touch_district_paths() -> None:
    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="776" height="813" '
        'viewBox="0 0 776 813">\n'
        '  <rect width="776" height="813" fill="#F2E8D5"/>\n'
        '  <g id="regions">\n'
        '<path d="M10,10 L20,10 L20,20 Z" fill="#EAD9BC" '
        'data-region="r0" data-name="Район"/>\n'
        "  </g>\n</svg>\n"
    )
    group = (
        '    <g id="water-overlay" data-layer-id="2" data-layer-type="overlay" '
        'data-layer-name="Волга">\n'
        '      <path d="M1,1 L2,1 L2,2 Z" fill="#B7C4BC" fill-opacity="0.5" '
        'data-region="w0" data-name="Волга"/>\n'
        "    </g>\n"
    )
    before = cat.region_path_ds(svg)
    out = cat.inject_overlay_group(svg, group)
    assert cat.region_path_ds(out) == before
    assert 'id="water-overlay"' in out
    assert out.find('id="regions"') < out.find('id="water-overlay"')
    assert 'data-layer-type="overlay"' in out
    assert 'M10,10 L20,10 L20,20 Z' in out


def test_seam_meters_scales_with_extent() -> None:
    oblast, simp_o = cat.seam_meters(305_000)
    city, simp_c = cat.seam_meters(66_000)
    assert abs(oblast - 700) < 30
    assert 80 < city < 200
    assert simp_c < simp_o
    assert city * 2 * cat.SVG_W / 66_000 < 5


def test_delete_project(tmp_path) -> None:
    cat.set_maps_root(tmp_path)
    try:
        meta = cat.create_project("Черновик")
        slug = meta["slug"]
        assert (tmp_path / slug / "map.svg").is_file()
        cat.delete_project(slug)
        assert cat.find_map(slug) is None
        assert not (tmp_path / slug).exists()
        assert cat.load_catalog()["maps"] == []
    finally:
        cat.set_maps_root(None)


if __name__ == "__main__":
    from pathlib import Path
    import tempfile

    test_place_kind()
    test_merge_city_alone()
    test_next_project_name()
    test_federal_city_kept()
    test_host_oblast_cities()
    test_water_body_label_keeps_osm_name()
    test_osm_water_tags()
    test_water_rel_too_big()
    test_water_layer_in_svg()
    test_large_water_is_clipped_not_dropped()
    test_unnamed_pond_is_not_a_body()
    test_overlay_does_not_touch_district_paths()
    test_seam_meters_scales_with_extent()
    with tempfile.TemporaryDirectory() as d:
        test_delete_project(Path(d))
    print("OK map_catalog")
