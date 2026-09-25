from flask import Flask, url_for, Blueprint, render_template, request, session, redirect

app = Flask(__name__)

@app.route('/')
def index():
    return

#insert more routes here

if __name__ == "__main__":
    app.run(debug=True)