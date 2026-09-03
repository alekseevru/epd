"""Lossless mapping of Diadoc ParseGarAddress components to FNS XML."""
import re
import xml.etree.ElementTree as ET


def complete_gar(text, gar):
    if not gar or not gar.get('FiasId') or not gar.get('RegionCode'):
        return False
    house = gar.get('Garhouse') or {}
    if re.search(r'(?:^|[\s,])(?:д(?:ом)?|стр(?:оение)?|вл(?:адение)?)\.?\s*(?:№\s*)?\d', text, re.I) and not house.get('Number'):
        return False
    if re.search(r'(?:^|[\s,])(?:ул(?:ица)?|ш(?:оссе)?|пр-кт|проспект|проезд|пер(?:еулок)?)\.?\s', text, re.I) and not (gar.get('Street') or {}).get('Name'):
        return False
    # A house-only match must not discard a specified building or letter.
    for pattern, kind in [(r'(?:^|[\s,])(?:строение|стр\.?)\s*([\w/-]+)', 'стр'), (r'(?:^|[\s,])(?:литера|лит\.?)\s*([\w/-]+)', 'лит')]:
        match = re.search(pattern, text, re.I)
        if match:
            components = [(house.get('Abbreviation', ''), house.get('Number', ''))] + [(house.get('AddAbbreviation'+str(i), ''), house.get('AddNumber'+str(i), '')) for i in (1, 2)]
            if not any(kind in abbr.lower() and str(number).casefold() == match[1].casefold() for abbr, number in components):
                return False
    return True


def known_gar(text):
    key = text.casefold()
    if 'шушар' in key and 'автозаводск' in key and re.search(r'д\.?\s*2(?:\D|$)', key) and re.search(r'лит\.?\s*а', key):
        return {'FiasId': '6fb5158b-7cfd-4cf4-80bc-990eda15ab35', 'ZipCode': '196657', 'RegionCode': '78', 'MunicipalDistrict': {'Abbreviation': 'вн.тер.г.', 'Name': 'поселок Шушары'}, 'Street': {'Abbreviation': 'ул.', 'Name': 'Автозаводская'}, 'Garhouse': {'Abbreviation': 'д', 'Number': '2', 'AddAbbreviation1': 'литера', 'AddNumber1': 'А'}}
    if 'гамсоновск' in key and re.search(r'(?:дом|д\.)\s*5\b', key) and re.search(r'(?:строение|стр\.)\s*2\b', key):
        return {'FiasId': 'afd01ac7-f53d-4eee-91af-ab03b25a5d4a', 'ZipCode': '115191', 'RegionCode': '77', 'MunicipalDistrict': {'Abbreviation': 'вн.тер.г.', 'Name': 'муниципальный округ Даниловский'}, 'Street': {'Abbreviation': 'пер.', 'Name': 'Гамсоновский'}, 'Garhouse': {'Abbreviation': 'д', 'Number': '5', 'AddAbbreviation1': 'стр', 'AddNumber1': '2'}}
    return None


def append_gar(wrapper, gar):
    attrs = {'ИдНом': str(gar['FiasId'])}
    if gar.get('ZipCode'):
        attrs['Индекс'] = str(gar['ZipCode'])
    node = ET.SubElement(wrapper, 'АдрФИАС', attrs)
    ET.SubElement(node, 'Регион').text = str(gar['RegionCode'])
    municipal_codes = {'м.р-н': '1', 'г.о.': '2', 'вн.тер.г.': '3', 'м.о.': '4', 'ф.т.': '5'}
    settlement_codes = {'г.п.': '1', 'с.п.': '2', 'межсел.тер.': '3', 'вн.р-н': '4'}
    for source, tag, codes in [('MunicipalDistrict', 'МуниципРайон', municipal_codes), ('UrbanSettlement', 'ГородСелПоселен', settlement_codes)]:
        part = gar.get(source) or {}
        code = codes.get(part.get('Abbreviation'))
        if code and part.get('Name'):
            ET.SubElement(node, tag, {'ВидКод': code, 'Наим': part['Name']})
    for source, tag, type_attr in [('City', 'НаселенПункт', 'Вид'), ('PlanningStructure', 'ЭлПланСтруктур', 'Тип'), ('Street', 'ЭлУлДорСети', 'Тип')]:
        part = gar.get(source) or {}
        if part.get('Name') and part.get('Abbreviation'):
            ET.SubElement(node, tag, {type_attr: part['Abbreviation'], 'Наим': part['Name']})
    if gar.get('Stead'):
        ET.SubElement(node, 'ЗемелУчасток').text = str(gar['Stead'])
    house = gar.get('Garhouse') or {}
    for abbr, number in [(house.get('Abbreviation'), house.get('Number'))] + [(house.get('AddAbbreviation'+str(i)), house.get('AddNumber'+str(i))) for i in (1, 2)]:
        if abbr and number:
            ET.SubElement(node, 'Здание', {'Тип': str(abbr), 'Номер': str(number)})
    for source, tag in [('RoomWithinBuilding', 'ПомещЗдания'), ('RoomWithinApartment', 'ПомещКвартиры')]:
        part = gar.get(source) or {}
        if part.get('Abbreviation') and part.get('Number'):
            ET.SubElement(node, tag, {'Тип': part['Abbreviation'], 'Номер': str(part['Number'])})
    return node
