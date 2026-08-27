.PHONY: dashboard build

dashboard:
	npm --prefix dashboard ci
	npm --prefix dashboard run build

build: dashboard
	uv build
