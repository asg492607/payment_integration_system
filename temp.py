import os
files = ['dashboard.html', 'login.html', 'checkout.html', 'pos.html', 'invoice.html']
footer = '<div style="text-align:center; padding: 20px; font-size: 0.8rem; color: #94a3b8; width: 100%; position: relative; z-index: 100;">Developed by ASG</div>\n</body>'
for f in files:
    if os.path.exists(f):
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
        if 'Developed by ASG' not in content:
            content = content.replace('</body>', footer)
            with open(f, 'w', encoding='utf-8') as file:
                file.write(content)
            print(f'Added footer to {f}')
