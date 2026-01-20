import json
import os

def get_keys(obj, prefix=''):
    keys = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            full_key = f"{prefix}.{k}" if prefix else k
            keys.append(full_key)
            keys.extend(get_keys(v, full_key))
    elif isinstance(obj, list):
        if obj and isinstance(obj[0], (dict, list)):
            # Use '[]' to represent an array element in the key path
            keys.extend(get_keys(obj[0], f"{prefix}[]" if prefix else "[]"))
    return list(set(keys))

target_modules = ['bom', 'item', 'workorder', 'bill', 'journal', 'receiving', 'invoice', 'salesorder']
base_path = 'recordings/dev/transactions'

for module in target_modules:
    mod_dir = os.path.join(base_path, module)
    if not os.path.exists(mod_dir):
        print(f"Directory not found: {mod_dir}")
        continue
    
    files = [f for f in os.listdir(mod_dir) if f.endswith('.json') and 'ref' not in f]
    if not files:
        print(f"No files found in: {mod_dir}")
        continue
    
    try:
        with open(os.path.join(mod_dir, files[0]), 'r') as f:
            data = json.load(f)
            keys = get_keys(data)
            keys.sort()
            print(f"--- MODULE: {module} ---")
            for key in keys:
                print(key)
    except Exception as e:
        print(f"Error processing {module}: {e}")
