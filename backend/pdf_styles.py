"""Fuentes embebidas para PDF consistentes en Windows y Linux."""
from pathlib import Path
import reportlab
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import getSampleStyleSheet

def portal_styles():
    folder=Path(reportlab.__file__).parent/'fonts'
    for name,file in {'PortalSans':'Vera.ttf','PortalSans-Bold':'VeraBd.ttf','PortalSans-Italic':'VeraIt.ttf','PortalSans-BoldItalic':'VeraBI.ttf'}.items():
        if name not in pdfmetrics.getRegisteredFontNames():pdfmetrics.registerFont(TTFont(name,str(folder/file)))
    pdfmetrics.registerFontFamily('PortalSans',normal='PortalSans',bold='PortalSans-Bold',italic='PortalSans-Italic',boldItalic='PortalSans-BoldItalic')
    styles=getSampleStyleSheet()
    for style in styles.byName.values():
        if hasattr(style,'fontName'):style.fontName='PortalSans-Bold' if 'Bold' in style.fontName else 'PortalSans'
    return styles
