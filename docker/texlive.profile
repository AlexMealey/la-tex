# install-tl profile: a small TeX Live with A4 as the default paper size.
# @TL_YEAR@ is replaced by the Dockerfile.
selected_scheme scheme-basic
TEXDIR /usr/local/texlive/@TL_YEAR@
TEXMFLOCAL /usr/local/texlive/texmf-local
TEXMFSYSCONFIG /usr/local/texlive/@TL_YEAR@/texmf-config
TEXMFSYSVAR /usr/local/texlive/@TL_YEAR@/texmf-var
TEXMFCONFIG ~/.texlive@TL_YEAR@/texmf-config
TEXMFVAR ~/.texlive@TL_YEAR@/texmf-var
TEXMFHOME ~/texmf
instopt_adjustpath 1
instopt_adjustrepo 0
instopt_letter 0
instopt_portable 0
instopt_write18_restricted 1
tlpdbopt_autobackup 0
tlpdbopt_install_docfiles 0
tlpdbopt_install_srcfiles 0
tlpdbopt_sys_bin /usr/local/bin
tlpdbopt_sys_info /usr/local/share/info
tlpdbopt_sys_man /usr/local/share/man
