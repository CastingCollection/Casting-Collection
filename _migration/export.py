import sqlite3, json, os

conn = sqlite3.connect('/tmp/cc.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

TABLES = [
    'settings','productions','agents','roles','artists','call_sheets',
    'banners','call_sheet_artists','pencil_dates','pencil_date_artists',
    'fitting_dates','shoot_days','briefs','roles_to_fit','presentations','zcards'
]

out = {}
for t in TABLES:
    cur.execute(f'SELECT * FROM {t}')
    rows = [dict(r) for r in cur.fetchall()]
    out[t] = rows
    print(t, len(rows))

os.makedirs('/home/claude/casting-collection-v2/_migration', exist_ok=True)
with open('/home/claude/casting-collection-v2/_migration/data.json', 'w') as f:
    json.dump(out, f)

print('done')
