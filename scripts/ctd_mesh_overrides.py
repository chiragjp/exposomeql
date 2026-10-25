# Curated per-variable CTD/MeSH decisions, reviewed by hand against CTD_chemicals.tsv.
# var -> (mesh_id, match)  where match in exact | parent | class
# "exact"  : CTD record is the measured analyte itself
# "parent" : analyte has no CTD record; mapped to parent compound / unresolved isomer
# "class"  : mapped to a chemical class / MeSH group descriptor
OV = {
  # aldehydes
  "LBX3AL": ("C005556", "exact"), "LBX5AL": ("C046012", "exact"), "LBX7AL": ("C046204", "exact"),
  "LBX8AL": ("C031639", "exact"), "LBX9AL": ("C008664", "exact"), "LBXI5AL": ("C032251", "exact"),
  "LBXV06": ("C026385", "exact"),
  # VOCs / isomers
  "LBXV2T": ("C035384", "parent"), "LBXV2C": ("C035384", "parent"), "LBXVXY": ("D014992", "class"),
  "URX2DC": ("D014241", "parent"), "URX34M": ("D014992", "parent"),
  "URXAAM": ("C569465", "exact"), "URXBPM": ("C118559", "parent"), "URXCYHA": ("C057647", "exact"),
  "URXDHB": ("C031763", "parent"), "URXDPM": ("D014992", "parent"), "URXHP2": ("C009068", "parent"),
  "URXIPM1": ("C005059", "parent"), "URXIPM3": ("C005059", "parent"),
  "URXMB1": ("C031763", "parent"), "URXMB2": ("C031763", "parent"), "URXMB3": ("C031763", "parent"),
  "URXPHE": ("C104837", "exact"), "URXPMA": ("C053003", "exact"), "URXPMM": ("C518631", "exact"),
  "URXTCV": ("C053445", "exact"),
  # amines / nitrosamines
  "URXMAAC": ("C017821", "exact"), "URXNPIP": ("C002743", "exact"), "URXPPDA": ("C029728", "exact"),
  # atrazine
  "URXDCZ": ("C526766", "exact"), "URXSIS": ("C027880", "exact"), "URXSISM": ("D001280", "parent"),
  # PBDEs (NHANES LBXBR1..9 = BDE-17,28,47,85,99,100,153,154,183)
  "LBXBR1": ("D055768", "class"), "LBXBR2": ("C533760", "exact"), "LBXBR3": ("C511295", "exact"),
  "LBXBR4": ("C086401", "class"), "LBXBR5": ("C477694", "exact"), "LBXBR6": ("C517827", "exact"),
  "LBXBR66": ("D055768", "class"), "LBXBR7": ("C517828", "exact"), "LBXBR8": ("C555859", "exact"),
  "LBXBR9": ("C483839", "exact"),
  # DEET
  "URXDEA": ("D003671", "parent"), "URXDHD": ("D003671", "parent"),
  # dialkyl phosphates
  "URXOP4": ("C035638", "exact"), "URXOP5": ("C040339", "exact"), "URXOP6": ("C059015", "exact"),
  # mercury species
  "LBXBGE": ("D005035", "class"), "LBDBGESI": ("D005035", "class"),
  "LBXBGM": ("D008767", "class"), "LBDBGMSI": ("D008767", "class"),
  "LBXIHG": ("D008628", "parent"),
  # PFAS
  "LBXEPAH": ("C542083", "exact"), "LBXBFOA": ("C023036", "parent"), "LBXNFOA": ("C023036", "exact"),
  "LBXMFOS": ("C076994", "parent"), "LBXNFOS": ("C076994", "exact"),
  # PAH metabolites
  "URXP03": ("C041509", "parent"), "URXP05": ("C031181", "parent"), "URXP07": ("C031181", "parent"),
  "URXP25": ("C031181", "parent"), "URXP09": ("C007738", "parent"),
  # dioxins / furans / coplanar PCBs
  "LBXD02": ("C078219", "exact"), "LBXD04": ("C018073", "parent"), "LBXTCD": ("D013749", "exact"),
  "LBXF05": ("D000072338", "class"), "LBXF06": ("D000072338", "class"),
  "LBXF07": ("D000072338", "class"), "LBXF09": ("D000072338", "class"),
  "LBXPCB": ("C023035", "exact"), "LBXTC2": ("D011078", "class"),
  # pesticides
  "URXMMI": ("C014655", "exact"), "URXDIZ": ("C561419", "exact"), "URXOXY": ("C561419", "exact"),
  "URXDPY": ("C014153", "parent"), "URXMAL": ("D008294", "parent"), "URXMET": ("C051786", "parent"),
  "URXALA": ("C000188", "parent"), "URXPAR": ("C024836", "exact"), "URXCMH": ("C305311", "exact"),
  # OP flame retardant metabolites
  "URXBCEP": ("C031324", "parent"), "URXDPHP": ("C005445", "parent"),
  # phthalates
  "URXCNP": ("C042080", "parent"), "URXCOP": ("C012125", "parent"), "URXMONP": ("C012125", "parent"),
  "URXECPT": ("C053316", "parent"), "URXMHHT": ("C053316", "parent"),
  "URXHIBP": ("C575690", "parent"), "URXMC1": ("D010795", "class"), "URXMCOH": ("C558012", "parent"),
  "URXMCP": ("C036042", "parent"), "URXMHBP": ("D003993", "parent"), "URXMHP": ("C016599", "exact"),
  # phenols
  "URXBPF": ("C008745", "exact"), "URXBPS": ("C543008", "exact"),
  # tobacco
  "URXNAB": ("C010257", "exact"), "URXNAT": ("C032978", "exact"),
  # nutrient biomarkers
  "LBXVIE": ("D024502", "exact"), "LBXATC": ("D024502", "exact"), "LBXDTC": ("C479072", "exact"),
  "LB2BEC": ("D019207", "exact"), "LBXBEC": ("D019207", "exact"), "LBXBCC": ("D019207", "exact"),
  "LB2CBC": ("D019207", "parent"), "LBXCBC": ("D019207", "parent"),
  "LB2LYC": ("D000077276", "exact"), "LBXLYC": ("D000077276", "exact"), "LBXCLC": ("D000077276", "parent"),
  "LB2LUZ": ("D014975", "parent"), "LBXLUZ": ("D014975", "parent"), "LBXCLZ": ("D014975", "parent"),
  "LBXACY": ("C587710", "exact"), "LBXARY": ("C587710", "exact"),
  "LBXDTA": ("C011395", "exact"), "LBXED1": ("C015876", "exact"), "LBXET1": ("C010944", "exact"),
  "LBXHDT": ("C008757", "parent"), "LBXOD1": ("C050413", "exact"), "LBXOTT": ("D019787", "parent"),
  "LBXMR1": ("D019814", "exact"), "LBXVE3MS": ("D002112", "parent"), "LBXVIDMS": ("D014807", "class"),
  "LBXMRG": ("C013102", "exact"),
}

# PCB congeners with no congener-specific CTD record -> PCB class
for _v in ["LBD199", "LBX044", "LBX087", "LBX146", "LBX157", "LBX172", "LBX177", "LBX178",
           "LBX183", "LBX194", "LBX195", "LBX196", "LBX206"]:
    OV.setdefault(_v, ("D011078", "class"))

# Dietary-recall / supplement components, keyed by the NHANES variable stem (after DR1T/DR2T/DRXT/DS1T/DS2T/DSQT/DRDT)
DIET = {
  "ACAR": ("C041635", "exact"), "ALCO": ("D000431", "exact"), "ATOA": ("D024502", "exact"),
  "ATOC": ("D024502", "exact"), "B12A": ("D014805", "exact"), "BCAR": ("D019207", "exact"),
  "CAFF": ("D002110", "exact"), "CALC": ("D002118", "exact"), "CARB": ("D004040", "class"),
  "CARO": ("D002338", "class"), "CHL": ("D002794", "exact"), "CHOL": ("D002784", "exact"),
  "COPP": ("D003300", "exact"), "CRYP": ("D000072743", "exact"), "FA": ("D005492", "exact"),
  "FDFE": ("D005492", "parent"), "FF": ("D005492", "parent"), "FIBE": ("D004043", "class"),
  "FOLA": ("D005492", "parent"), "IODI": ("D007455", "exact"), "IRON": ("D007501", "exact"),
  "LYCO": ("D000077276", "exact"), "LZ": ("D014975", "parent"), "MAGN": ("D008274", "exact"),
  "MFAT": ("D005229", "class"), "MOIS": ("D014867", "exact"), "WATE": ("D014867", "exact"),
  "NIAC": ("D009525", "exact"), "PFAT": ("D005231", "class"), "PHOS": ("D010758", "exact"),
  "POTA": ("D011188", "exact"), "RET": ("D014801", "exact"), "SELE": ("D012643", "exact"),
  "SFAT": ("D005227", "class"), "SODI": ("D012964", "exact"), "SUGR": ("D000073417", "class"),
  "TFAT": ("D004041", "class"), "THEO": ("D013805", "exact"), "VARA": ("D014801", "parent"),
  "VAIU": ("D014801", "parent"), "VARE": ("D014801", "parent"), "VB1": ("D013831", "exact"),
  "VB12": ("D014805", "exact"), "VB2": ("D012256", "exact"), "VB6": ("D025101", "exact"),
  "VC": ("D001205", "exact"), "VD": ("D014807", "exact"), "VE": ("D014810", "exact"),
  "VK": ("D014812", "exact"), "ZINC": ("D015032", "exact"),
  "S040": ("D020148", "exact"), "S060": ("C037652", "exact"), "S080": ("C031492", "exact"),
  "S100": ("C031071", "exact"), "S120": ("C030358", "exact"), "S140": ("D019814", "exact"),
  "S160": ("D019308", "exact"), "S180": ("C031183", "exact"),
  "M161": ("C008757", "parent"), "M181": ("D019301", "parent"), "M201": ("C572289", "exact"),
  "M221": ("C049811", "parent"),
  "P182": ("D019787", "parent"), "P183": ("D017962", "parent"), "P184": ("C062895", "parent"),
  "P204": ("D016718", "parent"), "P205": ("D015118", "exact"), "P225": ("C026219", "exact"),
  "P226": ("D004281", "exact"),
  # PROT (protein), KCAL (energy), NUMF/DSCNT/ANCNT (counts) intentionally unmapped: not chemicals in CTD
}

# Hit IDs that come from unit abbreviations / acronym collisions, never valid
BLACKLIST = {"C110832", "C000728248", "C511340", "C010407", "C074663", "C056729", "D020160", "C041665",
             "D000072317", "D000098704", "C049841"}
