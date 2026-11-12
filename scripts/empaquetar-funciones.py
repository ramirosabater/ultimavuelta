#!/usr/bin/env python3
"""Arma la versión en un solo archivo de cada función de Supabase, para pegarla en el editor de la página
(Edge Functions → Deploy a new function → Via Editor). Mete adentro los archivos locales que importa
(../_compartido/comun.ts, ./afip.ts) y deja arriba los import de npm.
Uso: python3 scripts/empaquetar-funciones.py   (escribe puesta-en-marcha/funciones/<nombre>.ts)"""
import os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUN = os.path.join(RAIZ, 'supabase', 'functions')
SALIDA = os.path.join(RAIZ, 'puesta-en-marcha', 'funciones')
IMPORT = re.compile(r"^import\s[\s\S]*?from\s+['\"]([^'\"]+)['\"]\s*;?\s*$", re.M)

def partes(ruta):
    """(imports externos, cuerpo sin imports, archivos locales importados)"""
    txt = open(ruta, encoding='utf-8').read()
    externos, locales = [], []
    def saca(m):
        origen = m.group(1)
        if origen.startswith('.'):
            locales.append(os.path.normpath(os.path.join(os.path.dirname(ruta), origen)))
        else:
            externos.append(m.group(0).strip())
        return ''
    # las líneas // @deno-types van pegadas a su import
    txt = re.sub(r"^// @deno-types=.*\n(?=import)", lambda m: '@@TIPOS@@' + m.group(0)[:-1] + '\n', txt, flags=re.M)
    cuerpo = IMPORT.sub(saca, txt.replace('@@TIPOS@@', ''))
    tipos = re.findall(r"^(// @deno-types=.*)\n(?=import)", open(ruta, encoding='utf-8').read(), re.M)
    externos = tipos + externos if tipos else externos
    cuerpo = re.sub(r"^// @deno-types=.*\n", '', cuerpo, flags=re.M)
    return externos, cuerpo.strip('\n'), locales

def empaquetar(nombre):
    entrada = os.path.join(FUN, nombre, 'index.ts')
    vistos, externos, bloques = set(), [], []
    def visitar(ruta, es_entrada=False):
        if ruta in vistos: return
        vistos.add(ruta)
        ext, cuerpo, locales = partes(ruta)
        for l in locales: visitar(l)
        for e in ext:
            if e not in externos: externos.append(e)
        rel = os.path.relpath(ruta, RAIZ)
        bloques.append(cuerpo if es_entrada else f"// ---- {rel} ----\n" + re.sub(r"^export (?=(const|function|async|class|interface|type) )", '', cuerpo, flags=re.M))
    visitar(entrada, True)
    principal = bloques.pop()
    cab = principal.split('\n'); com = []
    while cab and cab[0].startswith('//'): com.append(cab.pop(0))
    salida = '\n'.join([
        f"// Versión en un solo archivo para pegar en Supabase → Edge Functions → Deploy a new function → Via Editor (nombre: {nombre}).",
        f"// Se genera con scripts/empaquetar-funciones.py desde supabase/functions/{nombre}/: si cambia aquello, regenerar este.",
        *com, *externos, '', *bloques, '', "// ---- la función ----", '\n'.join(cab).strip('\n'), ''])
    open(os.path.join(SALIDA, f'{nombre}.ts'), 'w', encoding='utf-8').write(salida)
    print('listo', nombre)

for n in sys.argv[1:] or sorted(d for d in os.listdir(FUN) if not d.startswith('_') and os.path.isfile(os.path.join(FUN, d, 'index.ts'))):
    empaquetar(n)
