#!/usr/bin/env python3
"""Compute free FanYou fantasy scores from commissioner-supplied JSON statistics.
No account keys, network requests, external packages or automatic sports feed.
"""
import argparse
from decimal import Decimal
import json
from pathlib import Path
import re
import sys
from uuid import UUID
RULES = json.loads((Path(__file__).resolve().parents[1] / 'fantasy/rules.json').read_text())

def points(sport, stats):
    weights = RULES['sports'].get(sport)
    if weights is None or not isinstance(stats, dict):
        raise ValueError('Choose a supported sport and provide a stats object.')
    total = Decimal(0)
    for key, value in stats.items():
        if key not in weights or type(value) is not int or not 0 <= value <= 100000:
            raise ValueError('Statistics must be supported nonnegative whole numbers up to 100000.')
        total += Decimal(str(weights[key])) * value
    if abs(total) > 10000000:
        raise ValueError('Score is outside the permitted range.')
    return float(total)

def prepare(data):
    sport = data['sport']
    if sport not in RULES['sports'] or not re.fullmatch(r'[A-Za-z0-9_-]{1,24}', data['period']):
        raise ValueError('Invalid sport or period.')
    league = str(UUID(data['league_id']))
    records = data['records']
    if not isinstance(records, list) or not 1 <= len(records) <= 100:
        raise ValueError('Provide 1-100 records.')
    result, seen = [], set()
    for record in records:
        athlete = str(UUID(record['athlete_id']))
        if athlete in seen:
            raise ValueError('Duplicate athlete.')
        seen.add(athlete)
        result.append({'athlete_id': athlete, 'stats': record['stats'], 'points': points(sport, record['stats'])})
    return {'league_id': league, 'period': data['period'], 'rules_version': RULES['version'], 'records': result}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='JSON with league_id, sport, period and records')
    parser.add_argument('--out', type=Path, help='Write JSON for the commissioner import form')
    args = parser.parse_args()
    try:
        output = json.dumps(prepare(json.loads(args.input.read_text())), indent=2, allow_nan=False)
        if args.out:
            args.out.write_text(output + '\n')
        else:
            print(output)
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f'Invalid scoring input: {error}', file=sys.stderr)
        sys.exit(1)
