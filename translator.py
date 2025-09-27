import subprocess
import sys

def install_and_import(package, import_name=None):
    """
    Install and import a package if not already available.
    - package: the name used in pip install
    - import_name: the name used in import (if different from package)
    """
    import_name = import_name or package
    try:
        globals()[import_name] = __import__(import_name)
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])
        globals()[import_name] = __import__(import_name)

# Handle imports safely
install_and_import("asyncio")   # stdlib, will never install
install_and_import("googletrans")
install_and_import("flask")
install_and_import("flask_cors", "flask_cors")

import asyncio
from googletrans import Translator
from flask import Flask, request, jsonify
from flask_cors import CORS




app = Flask(__name__)
CORS(app)

@app.route('/translate',methods=['GET'])
def translate_text():
    text = request.args.get('text')
    src = request.args.get('src')
    dest = request.args.get('dest')
    translator = Translator()
    result = translator.translate(text, src=src, dest=dest)
    # return JSON with a clear property name
    return jsonify({"translated_text": result.text})


if __name__ == '__main__':
    app.run(port=5000)