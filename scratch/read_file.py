
with open('app/i18n/translations.ts', 'rb') as f:
    content = f.read().decode('utf-8', 'replace')

for i, line in enumerate(content.splitlines()):
    print(f"{i+1:4}: {line}")
