import subprocess
import sys

try:
    import asyncio
    from googletrans import Translator
except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "asyncio"])
        subprocess.check_call([sys.executable, "-m", "pip", "install", "googletrans"])
        import asyncio
        from googletrans import Translator


#
# translator = Translator()

# async def translate_text(text,src,dest):
#    async with Translator() as translator:
#        result = await translator.translate(text, src=src, dest=dest)
#        return result
#


# translator = Translator()
# translator.translate("hello",src="en",dest="ar")

from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/translate')
async def translate_text():
    async with Translator() as translator:
        text = request.args.get('text')
        src = request.args.get('src')
        dest = request.args.get('dest')
        result = await translator.translate(text, src=src, dest=dest)
        # return JSON with a clear property name
        return jsonify({"translated_text": result.text})


if __name__ == '__main__':
    app.run()